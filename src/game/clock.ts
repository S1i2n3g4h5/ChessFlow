import { GameState } from './types';

/**
 * Charges elapsed wall-clock time to the player whose turn it is. Mutates `state`.
 *
 * - While `paused` (lobby, name entry, a player disconnected) the reference point keeps
 *   moving forward, so no time is charged and nothing is drained when play resumes.
 * - Only whole seconds are charged; the sub-second remainder is carried over instead of
 *   being dropped, so frequent polling does not make the clock run slow or fast.
 */
export function tickClock(state: GameState, now: number, paused: boolean): void {
  if (state.status !== 'ONGOING') return;

  if (paused || state.lastTick === null) {
    state.lastTick = now;
    return;
  }

  const elapsedSeconds = Math.floor((now - state.lastTick) / 1000);
  if (elapsedSeconds <= 0) return;

  const player = state.currentPlayer;
  state.clocks[player] = Math.max(0, state.clocks[player] - elapsedSeconds);
  state.lastTick += elapsedSeconds * 1000;

  if (state.clocks[player] === 0) {
    state.status = player === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN';
    state.endReason = 'TIMEOUT';
    state.version += 1; // a real state change, so clients pick it up like any other
  }
}

/**
 * The game (and its clock) starts once both seats are filled, both players have entered a name,
 * and both have clicked "I'm ready" after the How-to-Play guide.
 */
export function isGameStarted(state: GameState, playerCount: number): boolean {
  return playerCount >= 2 && Boolean(state.names.WHITE) && Boolean(state.names.BLACK)
    && state.ready.WHITE && state.ready.BLACK;
}
