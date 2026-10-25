import { BoardAction, GameState } from './types';
import { createInitialGameState } from './utils';
import { gameReducer } from './reducer';

/**
 * Rebuilds the board as it was right after history[index].
 * index = -1 gives the starting position.
 */
export function reconstructState(history: BoardAction[], index: number): GameState {
  let state = createInitialGameState();
  for (let i = 0; i <= index && i < history.length; i++) {
    state = gameReducer(state, history[i]);
  }
  return state;
}
