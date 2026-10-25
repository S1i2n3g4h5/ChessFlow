import { NextResponse } from 'next/server';
import { Result, RoomStore, RoomView } from '@/server/roomStore';
import { ROOM_CONFIGS, ROOM_IDLE_LIMIT_MS } from '@/server/config';

/**
 * HTTP layer over the in-memory RoomStore.
 *
 *   GET  /api/game                              -> { rooms: [{ id, name }] }
 *   GET  /api/game?roomId=R&sessionId=S         -> { state, role, playerCount }   (poll)
 *   POST /api/game { op: 'join',   roomId, sessionId, passcode? }
 *   POST /api/game { op: 'action', roomId, sessionId, action }
 *   POST /api/game { op: 'reset',  roomId, sessionId }          (new game, same seats)
 *
 * Errors: { error: <code> } with a matching HTTP status (see ErrorCode in roomStore.ts).
 */

// Singleton store + sweep timer that survive dev hot reloads
const globalForGame = globalThis as unknown as {
  chessflowStore?: RoomStore;
  chessflowSweep?: ReturnType<typeof setInterval>;
};

const store = globalForGame.chessflowStore ??= new RoomStore(ROOM_CONFIGS, ROOM_IDLE_LIMIT_MS);

if (!globalForGame.chessflowSweep) {
  globalForGame.chessflowSweep = setInterval(() => store.sweep(Date.now()), 60_000);
  globalForGame.chessflowSweep.unref?.();
}

// Live game state must never come from a cache: a cached "410 room closed" once kicked out
// a player who had just rejoined (410 responses are cacheable by default in HTTP).
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function respond(result: Result<RoomView>) {
  if (!result.ok) return json({ error: result.error }, result.status);
  return json(result.value);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');
  if (!roomId) return json({ rooms: store.listRooms() });
  return respond(store.getState(roomId, searchParams.get('sessionId'), Date.now()));
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_REQUEST' }, 400);
  }
  if (!body || typeof body !== 'object' || typeof body.roomId !== 'string') {
    return json({ error: 'INVALID_REQUEST' }, 400);
  }

  const now = Date.now();
  switch (body.op) {
    case 'join':
      return respond(store.join(body.roomId, body.sessionId, body.passcode, now));
    case 'action':
      return respond(store.applyAction(body.roomId, body.sessionId, body.action, now));
    case 'reset':
      return respond(store.reset(body.roomId, body.sessionId, now));
    default:
      return json({ error: 'INVALID_REQUEST' }, 400);
  }
}
