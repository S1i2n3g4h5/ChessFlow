// Runs against a server started with CHESSFLOW_ROOM_IDLE_MS=10000 (a 10-second "3 hours").
import { check, joinViaUi, newPlayer, shot } from './harness.mjs';

export const EXPIRY_TEST_LIMIT_MS = 10000;

export async function expirySuite(BASE) {
  const P = await newPlayer('expiry');
  await joinViaUi(P, BASE, 'ALPHA', 'archon');
  const joinedAt = Date.now();

  // Polling every second is not activity, so the room closes ~10 s after the join
  await P.page.getByTestId('room-notice').waitFor({ timeout: 40000 });
  const openFor = Date.now() - joinedAt;
  const text = await P.page.getByTestId('room-notice').textContent();
  check('an inactive room is closed and the player is told why', /inactivity/i.test(text), text);
  check('the room stayed open until the inactivity limit (polling did not count as activity)', openFor >= EXPIRY_TEST_LIMIT_MS - 1500, `${openFor} ms`);
  check('after closing, the passcode screen for that room is shown', await P.page.getByTestId('passcode-input').isVisible());
  await shot(P.page, 'room-expired');

  await P.page.getByTestId('passcode-input').fill('archon');
  await P.page.getByTestId('passcode-submit').click();
  try {
    await P.page.getByTestId('lobby').waitFor({ timeout: 8000 });
    check('the closed room can be joined again with the passcode', true);
    await P.page.waitForTimeout(3000); // late answers to requests sent before the rejoin must not close it again
    check('after rejoining you stay in the room', await P.page.getByTestId('lobby').isVisible() && !(await P.page.getByTestId('room-notice').isVisible()));
    await shot(P.page, 'lobby');
  } catch {
    await shot(P.page, 'expiry-rejoin-failure');
    const err = await P.page.getByTestId('passcode-error').textContent().catch(() => null);
    const notice = await P.page.getByTestId('room-notice').textContent().catch(() => null);
    check('the closed room can be joined again with the passcode', false, `error=${err} notice=${notice} url=${P.page.url()}`);
  }
  await P.ctx.close();
}
