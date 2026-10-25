import { GameState, PlayerColor, TurnAction } from '@/game/types';
import { createInitialGameState } from '@/game/utils';
import { gameReducer } from '@/game/reducer';
import { isGameStarted, tickClock } from '@/game/clock';

/**
 * In-memory multiplayer rooms (no database by design).
 * All functions take `now` so the rules (seats, passcodes, expiry) can be unit-tested.
 * The server is the authority: a player's color always comes from their session, never from the request.
 */

export type Role = PlayerColor | 'SPECTATOR';

export interface RoomConfig {
  id: string;
  name: string;
  passcode: string;
}

interface Member {
  role: Role;
  joinedAt: number;
  lastSeen: number;
}

interface Room {
  config: RoomConfig;
  gameState: GameState;
  members: Record<string, Member>;   // sessionId -> member
  seats: Record<PlayerColor, string | null>;
  lastActivity: number;               // last join / accepted action / new game
  expiredSessions: Record<string, number>; // sessions removed by the inactivity rule -> when
}

export type ErrorCode =
  | 'UNKNOWN_ROOM'
  | 'INVALID_REQUEST'
  | 'PASSCODE_REQUIRED'
  | 'WRONG_PASSCODE'
  | 'NOT_JOINED'
  | 'ROOM_EXPIRED'
  | 'SPECTATOR'
  | 'GAME_NOT_STARTED'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'GAME_IN_PROGRESS';

const ERROR_STATUS: Record<ErrorCode, number> = {
  UNKNOWN_ROOM: 404,
  INVALID_REQUEST: 400,
  PASSCODE_REQUIRED: 401,
  WRONG_PASSCODE: 403,
  NOT_JOINED: 401,
  ROOM_EXPIRED: 410,
  SPECTATOR: 403,
  GAME_NOT_STARTED: 409,
  NOT_YOUR_TURN: 403,
  ILLEGAL_ACTION: 422,
  GAME_IN_PROGRESS: 409,
};

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: ErrorCode };

export interface RoomView {
  state: GameState;
  role: Role;
  playerCount: number;
}

export const DISCONNECT_MS = 10_000;          // clock pauses when a seated player is silent this long
export const ALL_GONE_RESET_MS = 15_000;      // room resets when every seated player is gone this long
export const DEFAULT_IDLE_LIMIT_MS = 3 * 60 * 60 * 1000; // 3 hours without activity closes a room
const EXPIRED_NOTICE_MS = 24 * 60 * 60 * 1000;           // how long an expired session gets the "closed" notice

const SESSION_PATTERN = /^[A-Za-z0-9-]{6,100}$/;
const ACTION_TYPES = new Set<TurnAction['type']>(['MOVE', 'EXPAND', 'SET_NAME', 'RESIGN', 'READY', 'OFFER_DRAW', 'RESPOND_DRAW']);

function fail<T>(error: ErrorCode): Result<T> {
  return { ok: false, status: ERROR_STATUS[error], error };
}

function isValidSession(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && SESSION_PATTERN.test(sessionId);
}

/** Rejects malformed payloads before they reach the rules engine. */
function isWellFormedAction(action: unknown): action is TurnAction {
  if (!action || typeof action !== 'object') return false;
  const a = action as Record<string, unknown>;
  if (typeof a.type !== 'string' || !ACTION_TYPES.has(a.type as TurnAction['type'])) return false;
  switch (a.type) {
    case 'MOVE':
      return typeof a.pieceId === 'string' && typeof a.toCellId === 'string';
    case 'EXPAND':
      return typeof a.cellId === 'string';
    case 'SET_NAME':
      return typeof a.name === 'string';
    case 'RESPOND_DRAW':
      return typeof a.accept === 'boolean';
    default:
      return true;
  }
}

export class RoomStore {
  private rooms: Record<string, Room> = {};

  constructor(configs: RoomConfig[], private idleLimitMs: number = DEFAULT_IDLE_LIMIT_MS, now = Date.now()) {
    for (const config of configs) {
      this.rooms[config.id] = {
        config,
        gameState: createInitialGameState(),
        members: {},
        seats: { WHITE: null, BLACK: null },
        lastActivity: now,
        expiredSessions: {},
      };
    }
  }

  /** Public room list: names only, never passcodes. */
  listRooms(): { id: string; name: string }[] {
    return Object.values(this.rooms).map(r => ({ id: r.config.id, name: r.config.name }));
  }

  join(roomId: string, sessionId: unknown, passcode: unknown, now: number): Result<RoomView> {
    const room = this.rooms[roomId];
    if (!room) return fail('UNKNOWN_ROOM');
    if (!isValidSession(sessionId)) return fail('INVALID_REQUEST');
    if (room.members[sessionId]) room.members[sessionId].lastSeen = now;
    this.sweep(now);

    const existing = room.members[sessionId];
    if (!existing) {
      // Rejoining (e.g. after a reload) needs no passcode; a new member does
      if (passcode === undefined || passcode === null || passcode === '') return fail('PASSCODE_REQUIRED');
      if (typeof passcode !== 'string' || passcode.trim().toUpperCase() !== room.config.passcode.toUpperCase()) {
        return fail('WRONG_PASSCODE');
      }
      room.members[sessionId] = { role: 'SPECTATOR', joinedAt: now, lastSeen: now };
      delete room.expiredSessions[sessionId];
      room.lastActivity = now;
      this.fillSeats(room);
    }

    room.members[sessionId].lastSeen = now;
    this.tick(room, now);
    return { ok: true, value: this.view(room, sessionId) };
  }

  getState(roomId: string, sessionId: unknown, now: number): Result<RoomView> {
    const room = this.rooms[roomId];
    if (!room) return fail('UNKNOWN_ROOM');
    const member = this.member(room, sessionId, now);
    if (!member.ok) return member;

    member.value.lastSeen = now;
    this.tick(room, now);
    return { ok: true, value: this.view(room, sessionId as string) };
  }

  applyAction(roomId: string, sessionId: unknown, action: unknown, now: number): Result<RoomView> {
    const room = this.rooms[roomId];
    if (!room) return fail('UNKNOWN_ROOM');
    const member = this.member(room, sessionId, now);
    if (!member.ok) return member;
    member.value.lastSeen = now;

    const role = member.value.role;
    if (role === 'SPECTATOR') return fail('SPECTATOR');
    if (!isWellFormedAction(action)) return fail('INVALID_REQUEST');

    this.tick(room, now);
    const state = room.gameState;

    let authorized: TurnAction;
    if (action.type === 'MOVE' || action.type === 'EXPAND') {
      if (!isGameStarted(state, this.seatedCount(room))) return fail('GAME_NOT_STARTED');
      if (state.currentPlayer !== role) return fail('NOT_YOUR_TURN');
      authorized = action;
    } else {
      if (action.type === 'OFFER_DRAW' && !isGameStarted(state, this.seatedCount(room))) return fail('GAME_NOT_STARTED');
      // Actions on behalf of a player always act for the sender's own color
      authorized = { ...action, player: role };
    }

    const next = gameReducer(state, authorized);
    if (next === state) return fail('ILLEGAL_ACTION');

    room.gameState = next;
    room.lastActivity = now;
    return { ok: true, value: this.view(room, sessionId as string) };
  }

  /** New game in the same room: seats, colors and names are kept. */
  reset(roomId: string, sessionId: unknown, now: number): Result<RoomView> {
    const room = this.rooms[roomId];
    if (!room) return fail('UNKNOWN_ROOM');
    const member = this.member(room, sessionId, now);
    if (!member.ok) return member;
    member.value.lastSeen = now;
    if (member.value.role === 'SPECTATOR') return fail('SPECTATOR');

    const state = room.gameState;
    if (state.status === 'ONGOING' && state.history.length > 0) return fail('GAME_IN_PROGRESS');

    const fresh = createInitialGameState();
    fresh.names = { ...state.names };
    room.gameState = fresh;
    room.lastActivity = now;
    return { ok: true, value: this.view(room, sessionId as string) };
  }

  /**
   * Housekeeping, run on every request and on a timer:
   * - 3 hours without activity: the room is closed (fresh board, everyone removed and told why)
   * - every seated player gone for 15 s: fresh board, seats go to whoever is still watching
   */
  sweep(now: number): void {
    for (const room of Object.values(this.rooms)) {
      for (const [sid, at] of Object.entries(room.expiredSessions)) {
        if (now - at > EXPIRED_NOTICE_MS) delete room.expiredSessions[sid];
      }

      const memberIds = Object.keys(room.members);
      if (memberIds.length === 0) continue;

      if (now - room.lastActivity > this.idleLimitMs) {
        for (const sid of memberIds) room.expiredSessions[sid] = now;
        room.members = {};
        room.seats = { WHITE: null, BLACK: null };
        room.gameState = createInitialGameState();
        room.lastActivity = now;
        continue;
      }

      const seated = [room.seats.WHITE, room.seats.BLACK].filter((s): s is string => s !== null);
      const allGone = seated.length > 0 && seated.every(sid => now - room.members[sid].lastSeen > ALL_GONE_RESET_MS);
      if (allGone) {
        for (const sid of seated) delete room.members[sid];
        for (const [sid, m] of Object.entries(room.members)) {
          if (now - m.lastSeen > ALL_GONE_RESET_MS) delete room.members[sid];
          else m.role = 'SPECTATOR';
        }
        room.seats = { WHITE: null, BLACK: null };
        room.gameState = createInitialGameState();
        this.fillSeats(room);
      }
    }
  }

  private member(room: Room, sessionId: unknown, now: number): Result<Member> {
    if (!isValidSession(sessionId)) return fail('INVALID_REQUEST');
    // Record this visit before housekeeping, so a returning player is not counted as gone
    if (room.members[sessionId]) room.members[sessionId].lastSeen = now;
    this.sweep(now);
    const member = room.members[sessionId];
    if (member) return { ok: true, value: member };
    return fail(room.expiredSessions[sessionId] !== undefined ? 'ROOM_EXPIRED' : 'NOT_JOINED');
  }

  /** Free seats go to the earliest-joined spectators: White first, then Black. */
  private fillSeats(room: Room): void {
    const waiting = Object.entries(room.members)
      .filter(([, m]) => m.role === 'SPECTATOR')
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    for (const color of ['WHITE', 'BLACK'] as PlayerColor[]) {
      if (room.seats[color] !== null) continue;
      const next = waiting.shift();
      if (!next) break;
      room.seats[color] = next[0];
      next[1].role = color;
    }
  }

  private seatedCount(room: Room): number {
    return (room.seats.WHITE ? 1 : 0) + (room.seats.BLACK ? 1 : 0);
  }

  private tick(room: Room, now: number): void {
    const missingPlayer = [room.seats.WHITE, room.seats.BLACK].some(
      sid => sid !== null && now - room.members[sid].lastSeen > DISCONNECT_MS
    );
    const paused = !isGameStarted(room.gameState, this.seatedCount(room)) || missingPlayer;
    tickClock(room.gameState, now, paused);
  }

  private view(room: Room, sessionId: string): RoomView {
    return { state: room.gameState, role: room.members[sessionId].role, playerCount: this.seatedCount(room) };
  }
}
