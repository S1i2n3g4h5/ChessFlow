// Talks to the API directly (like a hand-crafted request would) in Arena Beta.
import { apiPost, check } from './harness.mjs';

export async function securitySuite(BASE) {
  const ROOM = 'BETA';
  const W = 'e2e-sec-white-0001';
  const B = 'e2e-sec-black-0002';
  const S = 'e2e-sec-watch-0003';
  const get = async (sid) => {
    const res = await fetch(`${BASE}/api/game?roomId=${ROOM}&sessionId=${sid}`);
    return { status: res.status, data: await res.json() };
  };

  const list = await (await fetch(`${BASE}/api/game`)).json();
  check('room list has names only, no passcodes', JSON.stringify(list) === JSON.stringify({ rooms: [{ id: 'ALPHA', name: 'Arena Alpha' }, { id: 'BETA', name: 'Arena Beta' }] }), JSON.stringify(list));

  const html = await (await fetch(BASE)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const code = await Promise.all(scripts.map(async src => (await fetch(new URL(src, BASE))).text()));
  const leaked = [html, ...code].some(text => /ARCHON|PHANTOM/.test(text));
  check(`passcodes appear nowhere in the page or its ${scripts.length} JavaScript files`, scripts.length > 0 && !leaked);

  check('joining without a passcode is refused', (await apiPost(BASE, { op: 'join', roomId: ROOM, sessionId: W })).status === 401);
  check('joining with a wrong passcode is refused', (await apiPost(BASE, { op: 'join', roomId: ROOM, sessionId: W, passcode: 'ARCHON' })).status === 403);
  check('reading a room you have not joined is refused', (await get(W)).status === 401);
  const cacheHeaders = await Promise.all([
    fetch(`${BASE}/api/game`),
    fetch(`${BASE}/api/game?roomId=${ROOM}&sessionId=${W}`),
  ].map(async r => (await r).headers.get('cache-control')));
  check('game API responses are never cached (no-store), errors included', cacheHeaders.every(h => h === 'no-store'), JSON.stringify(cacheHeaders));

  await apiPost(BASE, { op: 'join', roomId: ROOM, sessionId: W, passcode: 'phantom' });
  await apiPost(BASE, { op: 'join', roomId: ROOM, sessionId: B, passcode: 'PHANTOM' });
  await apiPost(BASE, { op: 'join', roomId: ROOM, sessionId: S, passcode: 'PHANTOM' });
  const roles = await Promise.all([W, B, S].map(async sid => (await get(sid)).data.role));
  check('seats: White, Black, then spectator', roles.join(',') === 'WHITE,BLACK,SPECTATOR', roles.join(','));

  const moveBeforeNames = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'EXPAND', cellId: '3,7' } });
  check('no moves before both players have a name', moveBeforeNames.status === 409, String(moveBeforeNames.status));

  await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'SET_NAME', player: 'WHITE', name: 'SECW' } });
  const renamed = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: B, action: { type: 'SET_NAME', player: 'WHITE', name: 'HACKED' } });
  check("a player cannot rename the opponent (forged 'player' is ignored)", JSON.stringify(renamed.data.state.names) === JSON.stringify({ WHITE: 'SECW', BLACK: 'HACKED' }), JSON.stringify(renamed.data.state.names));

  const notReady = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'EXPAND', cellId: '3,7' } });
  check('no moves before both players are ready', notReady.status === 409, String(notReady.status));
  await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'READY', player: 'WHITE' } });
  await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: B, action: { type: 'READY', player: 'BLACK' } });

  const outOfTurn = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: B, action: { type: 'EXPAND', cellId: '3,7' } });
  check("Black cannot play on White's turn", outOfTurn.status === 403 && outOfTurn.data.error === 'NOT_YOUR_TURN', JSON.stringify(outOfTurn));

  const spectatorMove = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: S, action: { type: 'RESIGN', player: 'WHITE' } });
  check('spectators cannot act', spectatorMove.status === 403 && spectatorMove.data.error === 'SPECTATOR');

  const stranger = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: 'e2e-stranger-0009', action: { type: 'RESIGN', player: 'WHITE' } });
  check('non-members cannot act', stranger.status === 401);

  const before = (await get(W)).data.state;
  const legacy = await apiPost(BASE, { ...before, roomId: ROOM, version: before.version + 50 });
  check('the old "push a whole game state" request is gone', legacy.status === 400, String(legacy.status));
  const smuggled = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { ...before, version: 999 } });
  check('a game state disguised as an action is rejected', smuggled.status === 400, String(smuggled.status));
  check('the game is unchanged after the forged requests', (await get(W)).data.state.version === before.version);

  const illegal = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'EXPAND', cellId: '0,0' } });
  check('illegal moves are rejected (422)', illegal.status === 422, String(illegal.status));

  const legal = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: W, action: { type: 'EXPAND', cellId: '3,7' } });
  check('a legal action from the right player is accepted', legal.status === 200 && legal.data.state.history.length === 1);

  const resign = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: B, action: { type: 'RESIGN', player: 'WHITE' } });
  check("a forged resignation resigns the sender, not the opponent", resign.data.state.status === 'WHITE_WIN', resign.data.state.status);

  const specReset = await apiPost(BASE, { op: 'reset', roomId: ROOM, sessionId: S });
  check('spectators cannot start a new game', specReset.status === 403);
  const reset = await apiPost(BASE, { op: 'reset', roomId: ROOM, sessionId: B });
  check('a seated player can start a new game after the end', reset.status === 200 && reset.data.state.status === 'ONGOING');
}
