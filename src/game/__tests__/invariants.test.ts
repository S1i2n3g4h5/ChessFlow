import { describe, expect, it } from 'vitest';
import { createInitialGameState, opponentOf } from '../utils';
import { getLegalExpansionTargets, getLegalMoves, isInCheck } from '../engine';
import { gameReducer } from '../reducer';
import { reconstructState } from '../playback';
import { GameState, TurnAction } from '../types';
import { isActiveRegionConnected, seededRandom } from './helpers';

function allLegalActions(state: GameState): TurnAction[] {
  const moves = Object.values(state.pieces)
    .filter(p => p.owner === state.currentPlayer)
    .flatMap(p => getLegalMoves(state, p.id));
  const expansions = getLegalExpansionTargets(state).map(cellId => ({ type: 'EXPAND' as const, cellId }));
  return [...moves, ...expansions];
}

function checkInvariants(before: GameState, after: GameState) {
  const mover = before.currentPlayer;
  const pieces = Object.values(after.pieces);

  // Kings are never captured and the mover never leaves their own king in check
  expect(pieces.filter(p => p.type === 'KING')).toHaveLength(2);
  expect(isInCheck(after, mover)).toBe(false);

  // Pieces only stand on active cells, one per cell
  const occupied = new Set<string>();
  for (const p of pieces) {
    expect(after.board[p.cellId].active).toBe(true);
    expect(occupied.has(p.cellId)).toBe(false);
    occupied.add(p.cellId);
  }

  // The board is one region, and only the mover can own stabilizing cells right now
  expect(isActiveRegionConnected(after)).toBe(true);
  for (const cell of Object.values(after.board)) {
    if (cell.stabilizingUntil) expect(cell.stabilizingUntil).toBe(mover);
  }

  // Turn order, history and notation stay in step
  if (after.status === 'ONGOING') expect(after.currentPlayer).toBe(opponentOf(mover));
  expect(after.notation).toHaveLength(after.history.length);
  expect(after.version).toBe(before.version + 1);
}

describe('random legal games', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: every random legal turn keeps the game consistent`, () => {
      const random = seededRandom(seed);
      let state = createInitialGameState();

      for (let ply = 0; ply < 80 && state.status === 'ONGOING'; ply++) {
        const actions = allLegalActions(state);
        expect(actions.length).toBeGreaterThan(0); // an ongoing game always has a legal action
        // Favour piece moves so the games actually develop, but expand regularly too
        const moves = actions.filter(a => a.type === 'MOVE');
        const pool = moves.length > 0 && random() < 0.7 ? moves : actions;
        const action = pool[Math.floor(random() * pool.length)];

        const next = gameReducer(state, action);
        expect(next).not.toBe(state);
        checkInvariants(state, next);
        state = next;
      }

      // Replaying the history reproduces the exact same position
      const replayed = reconstructState(state.history, state.history.length - 1);
      expect(replayed.pieces).toEqual(state.pieces);
      expect(replayed.board).toEqual(state.board);
      expect(replayed.status).toBe(state.status);
      expect(replayed.notation).toEqual(state.notation);
    }, 60_000);
  }
});
