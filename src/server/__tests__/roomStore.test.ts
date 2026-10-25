import { describe, expect, it } from 'vitest';
import { ALL_GONE_RESET_MS, DEFAULT_IDLE_LIMIT_MS, DISCONNECT_MS, Result, RoomStore, RoomView } from '../roomStore';
import { getPieceAt } from '@/game/utils';
import { getLegalMoves } from '@/game/engine';
import { TurnAction } from '@/game/types';
import { sq } from '@/game/__tests__/helpers';

const T0 = 1_000_000_000;
const CONFIGS = [
  { id: 'ALPHA', name: 'Arena Alpha', passcode: 'ARCHON' },
  { id: 'BETA', name: 'Arena Beta', passcode: 'PHANTOM' },
];
const W = 'session-white-0001';
const B = 'session-black-0002';
const S = 'session-watch-0003';

function ok(result: Result<RoomView>): RoomView {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function errorOf(result: Result<RoomView>): string {
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

/** Store with White and Black seated and named, ready to play. */
function startedRoom(now = T0) {
  const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, now);
  ok(store.join('ALPHA', W, 'archon', now));
  ok(store.join('ALPHA', B, 'ARCHON', now));
  ok(store.applyAction('ALPHA', W, { type: 'SET_NAME', player: 'WHITE', name: 'ALICE' }, now));
  ok(store.applyAction('ALPHA', B, { type: 'SET_NAME', player: 'BLACK', name: 'BOBBY' }, now));
  ok(store.applyAction('ALPHA', W, { type: 'READY', player: 'WHITE' }, now));
  ok(store.applyAction('ALPHA', B, { type: 'READY', player: 'BLACK' }, now));
  return store;
}

function e2e4(view: RoomView): TurnAction {
  const pawn = getPieceAt(view.state, sq('e2'))!;
  return getLegalMoves(view.state, pawn.id).find(m => m.toCellId === sq('e4'))!;
}

describe('room list', () => {
  it('exposes room names but never passcodes', () => {
    const store = new RoomStore(CONFIGS);
    expect(store.listRooms()).toEqual([{ id: 'ALPHA', name: 'Arena Alpha' }, { id: 'BETA', name: 'Arena Beta' }]);
    expect(JSON.stringify(store.listRooms())).not.toMatch(/ARCHON|PHANTOM/);
  });
});

describe('joining', () => {
  it('requires the right passcode (case-insensitive)', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    expect(errorOf(store.join('ALPHA', W, undefined, T0))).toBe('PASSCODE_REQUIRED');
    expect(errorOf(store.join('ALPHA', W, 'wrong', T0))).toBe('WRONG_PASSCODE');
    expect(errorOf(store.join('ALPHA', W, 'PHANTOM', T0))).toBe('WRONG_PASSCODE'); // Beta's code
    expect(ok(store.join('ALPHA', W, ' archon ', T0)).role).toBe('WHITE');
  });

  it('rejects unknown rooms and malformed sessions', () => {
    const store = new RoomStore(CONFIGS);
    expect(errorOf(store.join('GAMMA', W, 'ARCHON', T0))).toBe('UNKNOWN_ROOM');
    expect(errorOf(store.join('ALPHA', 'x', 'ARCHON', T0))).toBe('INVALID_REQUEST');
    expect(errorOf(store.join('ALPHA', '../../etc', 'ARCHON', T0))).toBe('INVALID_REQUEST');
  });

  it('seats White, then Black, then spectators', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    expect(ok(store.join('ALPHA', W, 'ARCHON', T0)).role).toBe('WHITE');
    expect(ok(store.join('ALPHA', B, 'ARCHON', T0)).role).toBe('BLACK');
    const watcher = ok(store.join('ALPHA', S, 'ARCHON', T0));
    expect(watcher.role).toBe('SPECTATOR');
    expect(watcher.playerCount).toBe(2);
  });

  it('lets a member rejoin without the passcode (page reload) and keeps the seat', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    ok(store.join('ALPHA', W, 'ARCHON', T0));
    expect(ok(store.join('ALPHA', W, undefined, T0 + 1000)).role).toBe('WHITE');
  });

  it('keeps the two rooms separate', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    ok(store.join('ALPHA', W, 'ARCHON', T0));
    expect(ok(store.join('BETA', B, 'PHANTOM', T0)).role).toBe('WHITE');
    expect(errorOf(store.getState('BETA', W, T0))).toBe('NOT_JOINED');
  });
});

describe('reading state', () => {
  it('is only allowed for members', () => {
    const store = startedRoom();
    expect(errorOf(store.getState('ALPHA', S, T0))).toBe('NOT_JOINED');
    expect(ok(store.getState('ALPHA', W, T0)).role).toBe('WHITE');
  });
});

describe('actions: the server decides who may do what', () => {
  it('lets the side to move play', () => {
    const store = startedRoom();
    const view = ok(store.getState('ALPHA', W, T0));
    const after = ok(store.applyAction('ALPHA', W, e2e4(view), T0));
    expect(after.state.history).toHaveLength(1);
    expect(after.state.currentPlayer).toBe('BLACK');
  });

  it("rejects a move sent by the player whose turn it isn't", () => {
    const store = startedRoom();
    const view = ok(store.getState('ALPHA', W, T0));
    expect(errorOf(store.applyAction('ALPHA', B, e2e4(view), T0))).toBe('NOT_YOUR_TURN');
  });

  it('rejects every action from spectators and non-members', () => {
    const store = startedRoom();
    ok(store.join('ALPHA', S, 'ARCHON', T0));
    const view = ok(store.getState('ALPHA', W, T0));
    expect(errorOf(store.applyAction('ALPHA', S, e2e4(view), T0))).toBe('SPECTATOR');
    expect(errorOf(store.applyAction('ALPHA', S, { type: 'RESIGN', player: 'WHITE' }, T0))).toBe('SPECTATOR');
    expect(errorOf(store.applyAction('ALPHA', 'session-stranger-9', { type: 'RESIGN', player: 'WHITE' }, T0))).toBe('NOT_JOINED');
  });

  it('ignores a forged player field: you can only resign or rename yourself', () => {
    const store = startedRoom();
    const resigned = ok(store.applyAction('ALPHA', B, { type: 'RESIGN', player: 'WHITE' }, T0));
    expect(resigned.state.status).toBe('WHITE_WIN'); // Black resigned, not White

    const other = startedRoom();
    const renamed = ok(other.applyAction('ALPHA', B, { type: 'SET_NAME', player: 'WHITE', name: 'HACKED' }, T0));
    expect(renamed.state.names).toEqual({ WHITE: 'ALICE', BLACK: 'HACKED' });
  });

  it('rejects illegal and malformed actions without changing the game', () => {
    const store = startedRoom();
    const before = ok(store.getState('ALPHA', W, T0)).state;
    const pawn = getPieceAt(before, sq('e2'))!;
    expect(errorOf(store.applyAction('ALPHA', W, { type: 'MOVE', pieceId: pawn.id, toCellId: sq('e6') }, T0))).toBe('ILLEGAL_ACTION');
    expect(errorOf(store.applyAction('ALPHA', W, { type: 'MOVE' }, T0))).toBe('INVALID_REQUEST');
    expect(errorOf(store.applyAction('ALPHA', W, { type: 'HACK' }, T0))).toBe('INVALID_REQUEST');
    expect(errorOf(store.applyAction('ALPHA', W, null, T0))).toBe('INVALID_REQUEST');
    // A whole replacement state (the removed legacy push) is not an action at all
    expect(errorOf(store.applyAction('ALPHA', W, { ...before, version: 999 }, T0))).toBe('INVALID_REQUEST');
    expect(ok(store.getState('ALPHA', W, T0)).state.version).toBe(before.version);
  });

  it('does not allow moves before both players are seated, named and ready', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    const view = ok(store.join('ALPHA', W, 'ARCHON', T0));
    expect(errorOf(store.applyAction('ALPHA', W, e2e4(view), T0))).toBe('GAME_NOT_STARTED');
    ok(store.join('ALPHA', B, 'ARCHON', T0));
    expect(errorOf(store.applyAction('ALPHA', W, e2e4(view), T0))).toBe('GAME_NOT_STARTED'); // no names yet
    ok(store.applyAction('ALPHA', W, { type: 'SET_NAME', player: 'WHITE', name: 'ALICE' }, T0));
    ok(store.applyAction('ALPHA', B, { type: 'SET_NAME', player: 'BLACK', name: 'BOBBY' }, T0));
    ok(store.applyAction('ALPHA', W, { type: 'READY', player: 'WHITE' }, T0));
    expect(errorOf(store.applyAction('ALPHA', W, e2e4(view), T0))).toBe('GAME_NOT_STARTED'); // Black still reading the guide
    ok(store.applyAction('ALPHA', B, { type: 'READY', player: 'WHITE' }, T0)); // forged color: marks Black
    expect(ok(store.applyAction('ALPHA', W, e2e4(view), T0)).state.history).toHaveLength(1);
  });

  it('keeps the clock still until both players are ready', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    ok(store.join('ALPHA', W, 'ARCHON', T0));
    ok(store.join('ALPHA', B, 'ARCHON', T0));
    ok(store.applyAction('ALPHA', W, { type: 'SET_NAME', player: 'WHITE', name: 'ALICE' }, T0));
    ok(store.applyAction('ALPHA', B, { type: 'SET_NAME', player: 'BLACK', name: 'BOBBY' }, T0));
    ok(store.getState('ALPHA', B, T0 + 5000));
    expect(ok(store.getState('ALPHA', W, T0 + 9000)).state.clocks.WHITE).toBe(1800);
  });
});

describe('draw offers through the server', () => {
  it('an offer and its answer always act for the sender, never the other color', () => {
    const store = startedRoom();
    // Black forges an offer "from White" and then tries to accept it
    const offered = ok(store.applyAction('ALPHA', B, { type: 'OFFER_DRAW', player: 'WHITE' }, T0));
    expect(offered.state.drawOffer).toBe('BLACK');
    expect(errorOf(store.applyAction('ALPHA', B, { type: 'RESPOND_DRAW', player: 'WHITE', accept: true }, T0))).toBe('ILLEGAL_ACTION');
    const accepted = ok(store.applyAction('ALPHA', W, { type: 'RESPOND_DRAW', player: 'BLACK', accept: true }, T0));
    expect(accepted.state.status).toBe('DRAW');
    expect(accepted.state.endReason).toBe('AGREEMENT');
  });

  it('rejects malformed answers and offers before the game starts', () => {
    const store = startedRoom();
    ok(store.applyAction('ALPHA', W, { type: 'OFFER_DRAW', player: 'WHITE' }, T0));
    expect(errorOf(store.applyAction('ALPHA', B, { type: 'RESPOND_DRAW', player: 'BLACK', accept: 'yes' }, T0))).toBe('INVALID_REQUEST');

    const lobby = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    ok(lobby.join('ALPHA', W, 'ARCHON', T0));
    expect(errorOf(lobby.applyAction('ALPHA', W, { type: 'OFFER_DRAW', player: 'WHITE' }, T0))).toBe('GAME_NOT_STARTED');
  });

  it('spectators cannot offer or answer', () => {
    const store = startedRoom();
    ok(store.join('ALPHA', S, 'ARCHON', T0));
    expect(errorOf(store.applyAction('ALPHA', S, { type: 'OFFER_DRAW', player: 'WHITE' }, T0))).toBe('SPECTATOR');
  });
});

describe('new game (reset)', () => {
  it('is refused while a game is in progress', () => {
    const store = startedRoom();
    const view = ok(store.getState('ALPHA', W, T0));
    ok(store.applyAction('ALPHA', W, e2e4(view), T0));
    expect(errorOf(store.reset('ALPHA', W, T0))).toBe('GAME_IN_PROGRESS');
  });

  it('a new game asks both players to get ready again', () => {
    const store = startedRoom();
    ok(store.applyAction('ALPHA', W, { type: 'RESIGN', player: 'WHITE' }, T0));
    expect(ok(store.reset('ALPHA', W, T0)).state.ready).toEqual({ WHITE: false, BLACK: false });
  });

  it('works after the game ends, keeps seats and names, and gives a new game id', () => {
    const store = startedRoom();
    const before = ok(store.applyAction('ALPHA', W, { type: 'RESIGN', player: 'WHITE' }, T0)).state;
    const after = ok(store.reset('ALPHA', B, T0)).state;
    expect(after.status).toBe('ONGOING');
    expect(after.history).toEqual([]);
    expect(after.names).toEqual({ WHITE: 'ALICE', BLACK: 'BOBBY' });
    expect(after.gameId).not.toBe(before.gameId);
    expect(ok(store.getState('ALPHA', W, T0)).role).toBe('WHITE');
  });

  it('is refused for spectators', () => {
    const store = startedRoom();
    ok(store.join('ALPHA', S, 'ARCHON', T0));
    ok(store.applyAction('ALPHA', W, { type: 'RESIGN', player: 'WHITE' }, T0));
    expect(errorOf(store.reset('ALPHA', S, T0))).toBe('SPECTATOR');
  });
});

describe('3-hour inactivity rule', () => {
  const HOUR = 60 * 60 * 1000;

  it('closes a room 3 hours after the last activity and tells its members why', () => {
    const store = startedRoom();
    // Polling keeps happening (a forgotten open tab) but is not activity
    for (let t = T0; t < T0 + 3 * HOUR; t += HOUR / 2) ok(store.getState('ALPHA', W, t));
    expect(errorOf(store.getState('ALPHA', W, T0 + 3 * HOUR + 1))).toBe('ROOM_EXPIRED');
    expect(errorOf(store.getState('ALPHA', B, T0 + 3 * HOUR + 2))).toBe('ROOM_EXPIRED');
  });

  it('a move resets the 3-hour countdown', () => {
    const store = startedRoom();
    const view = ok(store.getState('ALPHA', W, T0));
    ok(store.applyAction('ALPHA', W, e2e4(view), T0 + 2 * HOUR));
    ok(store.getState('ALPHA', B, T0 + 4 * HOUR)); // 2h after the move: still open
    expect(errorOf(store.getState('ALPHA', B, T0 + 5 * HOUR + 1))).toBe('ROOM_EXPIRED');
  });

  it('also closes a room that is stuck in the lobby', () => {
    const store = new RoomStore(CONFIGS, DEFAULT_IDLE_LIMIT_MS, T0);
    ok(store.join('ALPHA', W, 'ARCHON', T0));
    expect(errorOf(store.getState('ALPHA', W, T0 + 3 * HOUR + 1))).toBe('ROOM_EXPIRED');
  });

  it('the closed room is fresh and can be joined again with the passcode', () => {
    const store = startedRoom();
    store.sweep(T0 + 3 * HOUR + 1);
    const later = T0 + 3 * HOUR + 2;
    expect(errorOf(store.join('ALPHA', S, undefined, later))).toBe('PASSCODE_REQUIRED');
    const view = ok(store.join('ALPHA', S, 'ARCHON', later));
    expect(view.role).toBe('WHITE');
    expect(view.state.names).toEqual({ WHITE: '', BLACK: '' });
  });

  it('respects a custom limit (used by the browser tests)', () => {
    const store = new RoomStore(CONFIGS, 5000, T0);
    ok(store.join('ALPHA', W, 'ARCHON', T0));
    ok(store.getState('ALPHA', W, T0 + 4000));
    expect(errorOf(store.getState('ALPHA', W, T0 + 5001))).toBe('ROOM_EXPIRED');
  });
});

describe('presence', () => {
  it('pauses the clock while a seated player is disconnected', () => {
    const store = startedRoom();
    ok(store.getState('ALPHA', W, T0));
    ok(store.getState('ALPHA', B, T0));
    ok(store.getState('ALPHA', W, T0 + 5000)); // both present: 5 s charged to White
    expect(ok(store.getState('ALPHA', W, T0 + 5000)).state.clocks.WHITE).toBe(1795);

    // Black stops polling; once silent for > 10 s the clock stops
    const t = T0 + 5000 + DISCONNECT_MS + 1000;
    ok(store.getState('ALPHA', W, t));
    const later = ok(store.getState('ALPHA', W, t + 8000)).state.clocks.WHITE;
    expect(later).toBe(ok(store.getState('ALPHA', W, t)).state.clocks.WHITE);
  });

  it('resets the room when every seated player has been gone for 15 s, and seats active watchers', () => {
    const store = startedRoom();
    ok(store.join('ALPHA', S, 'ARCHON', T0));
    const t = T0 + ALL_GONE_RESET_MS + 1;
    ok(store.getState('ALPHA', S, t - 1)); // the spectator is still here
    const view = ok(store.getState('ALPHA', S, t));
    expect(view.role).toBe('WHITE');
    expect(view.playerCount).toBe(1);
    expect(errorOf(store.getState('ALPHA', W, t))).toBe('NOT_JOINED');
  });
});
