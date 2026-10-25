import { describe, expect, it } from 'vitest';
import { GameState, TurnAction } from '../../types';
import { createInitialGameState, getPieceAt } from '../../utils';
import { gameReducer } from '../../reducer';
import { getLegalExpansionTargets } from '../../engine';
import { BOT_LEVELS, chooseAction, respondToDraw } from '../bot';
import { emptyGame, play, put, seededRandom, sq } from '../../__tests__/helpers';

const fast = { timeMs: 3000, maxNodes: 200_000 }; // deterministic node budget for tests

function apply(state: GameState, action: TurnAction): GameState {
  const next = gameReducer(state, action);
  expect(next).not.toBe(state); // the rules engine accepted the bot's action
  return next;
}

describe('computer opponent', () => {
  it('plays a legal opening move at every level', () => {
    for (const level of ['EASY', 'MEDIUM', 'HARD'] as const) {
      const decision = chooseAction(createInitialGameState(), level, seededRandom(1), { timeMs: 500, maxDepth: 3 });
      apply(createInitialGameState(), decision.action);
    }
  });

  it('finds mate in one', () => {
    // Fool's mate set-up: after 1.f3 e5 2.g4, Black mates with Qh4#
    let state = createInitialGameState();
    state = play(state, sq('f2'), sq('f3'));
    state = play(state, sq('e7'), sq('e5'));
    state = play(state, sq('g2'), sq('g4'));
    const decision = chooseAction(state, 'MEDIUM', seededRandom(1), fast);
    const after = apply(state, decision.action);
    expect(after.status).toBe('BLACK_WIN');
    expect(after.endReason).toBe('CHECKMATE');
  });

  it('captures a hanging queen', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'KING', 'BLACK', sq('e8'));
    put(state, 'ROOK', 'WHITE', sq('a1'));
    put(state, 'QUEEN', 'BLACK', sq('a6')); // undefended
    const decision = chooseAction(state, 'MEDIUM', seededRandom(1), fast);
    expect(decision.action).toMatchObject({ type: 'MOVE', toCellId: sq('a6') });
  });

  it('does not leave its queen hanging (Medium)', () => {
    // Black's queen on d4 is attacked by a white pawn on c3, which a white knight defends
    const state = emptyGame('BLACK');
    put(state, 'KING', 'WHITE', sq('g1'));
    put(state, 'KING', 'BLACK', sq('g8'));
    put(state, 'QUEEN', 'BLACK', sq('d4'));
    put(state, 'PAWN', 'WHITE', sq('c3'));
    put(state, 'KNIGHT', 'WHITE', sq('b1'));
    put(state, 'ROOK', 'WHITE', sq('a1'));
    const decision = chooseAction(state, 'MEDIUM', seededRandom(1), fast);
    const after = apply(state, decision.action);
    const queen = Object.values(after.pieces).find(p => p.type === 'QUEEN' && p.owner === 'BLACK')!;
    expect(queen.cellId).not.toBe(sq('d4'));
    expect(queen.cellId).not.toBe(sq('c3')); // the pawn is defended: taking it loses the queen
  });

  it('answers a check with a legal move', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'ROOK', 'BLACK', sq('e8'));
    put(state, 'KING', 'BLACK', sq('a8'));
    put(state, 'KNIGHT', 'WHITE', sq('g1'));
    const decision = chooseAction(state, 'HARD', seededRandom(1), fast);
    expect(decision.action.type).toBe('MOVE');
    apply(state, decision.action);
  });

  it('expands when that is the only legal action', () => {
    const state = emptyGame('BLACK');
    put(state, 'KING', 'BLACK', sq('a8'));
    put(state, 'QUEEN', 'WHITE', sq('c7'));
    put(state, 'KING', 'WHITE', sq('h1'));
    expect(getLegalExpansionTargets(state).length).toBeGreaterThan(0);
    const decision = chooseAction(state, 'MEDIUM', seededRandom(1), fast);
    expect(decision.action.type).toBe('EXPAND');
    apply(state, decision.action);
  });

  it('every action it picks over several random games is accepted by the rules engine', () => {
    for (const seed of [1, 2, 3]) {
      const random = seededRandom(seed);
      let state = createInitialGameState();
      for (let ply = 0; ply < 24 && state.status === 'ONGOING'; ply++) {
        const level = (['EASY', 'MEDIUM'] as const)[ply % 2];
        state = apply(state, chooseAction(state, level, random, { timeMs: 150, maxNodes: 20_000 }).action);
      }
    }
  }, 60_000);

  it('respects its thinking-time limit', () => {
    const start = Date.now();
    chooseAction(createInitialGameState(), 'HARD', seededRandom(1), { timeMs: 600 });
    expect(Date.now() - start).toBeLessThan(600 + 400);
  });

  it('accepts a draw only when it is clearly worse', () => {
    const losing = emptyGame();
    put(losing, 'KING', 'WHITE', sq('e1'));
    put(losing, 'QUEEN', 'WHITE', sq('d1'));
    put(losing, 'ROOK', 'WHITE', sq('a1'));
    put(losing, 'KING', 'BLACK', sq('e8'));
    expect(respondToDraw(losing, 'BLACK')).toBe(true);
    expect(respondToDraw(losing, 'WHITE')).toBe(false);
    expect(respondToDraw(createInitialGameState(), 'BLACK')).toBe(false);
  });

  it('reports search statistics (benchmark)', () => {
    const decision = chooseAction(createInitialGameState(), 'MEDIUM', seededRandom(1), { timeMs: 1000 });
    const nps = Math.round(decision.nodes / Math.max(decision.elapsedMs, 1) * 1000);
    console.log(`[bot benchmark] depth ${decision.depth}, ${decision.nodes} nodes in ${Math.round(decision.elapsedMs)} ms = ${nps} nodes/s`);
    expect(decision.depth).toBeGreaterThanOrEqual(3);
    expect(BOT_LEVELS.HARD.search.timeMs).toBeLessThanOrEqual(3000);
  });

  it('keeps the original piece ids when converting moves back to actions', () => {
    const state = createInitialGameState();
    const decision = chooseAction(state, 'EASY', seededRandom(3), { timeMs: 200 });
    if (decision.action.type === 'MOVE') {
      expect(state.pieces[decision.action.pieceId]).toBeDefined();
      expect(getPieceAt(state, state.pieces[decision.action.pieceId].cellId)).toBeDefined();
    }
  });
});
