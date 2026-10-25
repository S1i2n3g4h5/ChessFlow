import { describe, expect, it } from 'vitest';
import { isGameStarted, tickClock } from '../clock';
import { createInitialGameState, INITIAL_CLOCK_SECONDS } from '../utils';

const T0 = 1_000_000;

describe('tickClock', () => {
  it('only anchors the clock on the first tick', () => {
    const state = createInitialGameState();
    tickClock(state, T0, false);
    expect(state.lastTick).toBe(T0);
    expect(state.clocks.WHITE).toBe(INITIAL_CLOCK_SECONDS);
  });

  it('charges whole seconds to the side to move', () => {
    const state = createInitialGameState();
    tickClock(state, T0, false);
    tickClock(state, T0 + 3000, false);
    expect(state.clocks.WHITE).toBe(INITIAL_CLOCK_SECONDS - 3);
    expect(state.clocks.BLACK).toBe(INITIAL_CLOCK_SECONDS);
  });

  it('keeps the sub-second remainder instead of dropping it', () => {
    const state = createInitialGameState();
    tickClock(state, T0, false);
    tickClock(state, T0 + 1600, false); // 1 s charged, 0.6 s carried
    tickClock(state, T0 + 2100, false); // 2.1 s in total -> 2 s charged
    expect(state.clocks.WHITE).toBe(INITIAL_CLOCK_SECONDS - 2);
    expect(state.lastTick).toBe(T0 + 2000);
  });

  it('does not run while paused, and does not drain the paused time afterwards', () => {
    const state = createInitialGameState();
    tickClock(state, T0, false);
    tickClock(state, T0 + 60_000, true); // e.g. waiting in the lobby for a whole minute
    tickClock(state, T0 + 61_000, false);
    expect(state.clocks.WHITE).toBe(INITIAL_CLOCK_SECONDS - 1);
  });

  it('ends the game on time', () => {
    const state = createInitialGameState();
    state.currentPlayer = 'BLACK';
    state.clocks.BLACK = 2;
    tickClock(state, T0, false);
    tickClock(state, T0 + 5000, false);
    expect(state.clocks.BLACK).toBe(0);
    expect(state.status).toBe('WHITE_WIN');
    expect(state.endReason).toBe('TIMEOUT');
  });

  it('does nothing once the game is over', () => {
    const state = createInitialGameState();
    state.status = 'DRAW';
    tickClock(state, T0, false);
    tickClock(state, T0 + 5000, false);
    expect(state.clocks.WHITE).toBe(INITIAL_CLOCK_SECONDS);
    expect(state.lastTick).toBeNull();
  });
});

describe('isGameStarted', () => {
  it('needs two seated players who have both entered a name and are both ready', () => {
    const state = createInitialGameState();
    expect(isGameStarted(state, 2)).toBe(false);
    state.names.WHITE = 'AMAN';
    state.names.BLACK = 'ZEN';
    expect(isGameStarted(state, 2)).toBe(false); // nobody ready yet
    state.ready.WHITE = true;
    expect(isGameStarted(state, 2)).toBe(false); // waiting for Black to finish the guide
    state.ready.BLACK = true;
    expect(isGameStarted(state, 1)).toBe(false);
    expect(isGameStarted(state, 2)).toBe(true);
  });
});
