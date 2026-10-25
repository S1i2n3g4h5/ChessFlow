import { describe, expect, it } from 'vitest';
import { GUIDE_STEPS } from '../guide';
import { getLegalExpansionTargets, getLegalMoves, isInCheck } from '../engine';
import { gameReducer } from '../reducer';
import { TurnAction } from '../types';

function allActions(state: ReturnType<typeof GUIDE_STEPS[number]['scenario']>): TurnAction[] {
  const moves = Object.values(state.pieces).filter(p => p.owner === state.currentPlayer).flatMap(p => getLegalMoves(state, p.id));
  return [...moves, ...getLegalExpansionTargets(state).map(cellId => ({ type: 'EXPAND' as const, cellId }))];
}

describe('How-to-Play guide', () => {
  it('has a start, a ready step and unique ids', () => {
    expect(GUIDE_STEPS[0].id).toBe('welcome');
    expect(GUIDE_STEPS.at(-1)!.id).toBe('ready');
    expect(new Set(GUIDE_STEPS.map(s => s.id)).size).toBe(GUIDE_STEPS.length);
  });

  for (const step of GUIDE_STEPS) {
    it(`step "${step.id}": the position is playable and its goal can be reached`, () => {
      const state = step.scenario();
      expect(state.status).toBe('ONGOING');
      expect(state.currentPlayer).toBe('WHITE');
      if (!step.goal) return;
      const reaching = allActions(state).filter(a => {
        const next = gameReducer(state, a);
        return next !== state && step.goal!(state, a, next);
      });
      expect(reaching.length).toBeGreaterThan(0);
    });
  }

  it('stabilizing step: the rook really cannot enter the orange cell', () => {
    const step = GUIDE_STEPS.find(s => s.id === 'stabilizing')!;
    const state = step.scenario();
    const orange = Object.values(state.board).find(c => c.stabilizingUntil)!;
    const rook = Object.values(state.pieces).find(p => p.type === 'ROOK')!;
    expect(getLegalMoves(state, rook.id).map(m => m.toCellId)).not.toContain(orange.id);
  });

  it('king step: White is in check and no expansion is offered', () => {
    const state = GUIDE_STEPS.find(s => s.id === 'king-rules')!.scenario();
    expect(isInCheck(state, 'WHITE')).toBe(true);
    expect(getLegalExpansionTargets(state)).toEqual([]);
  });

  it('promotion step: the pawn on the usual last rank must still go one cell further', () => {
    const state = GUIDE_STEPS.find(s => s.id === 'promotion')!.scenario();
    const pawn = Object.values(state.pieces).find(p => p.type === 'PAWN')!;
    const moves = getLegalMoves(state, pawn.id);
    expect(moves.length).toBe(4); // one target cell, four promotion choices
    expect(moves.every(m => m.promotionTo)).toBe(true);
  });

  it('every scenario is a fresh copy (playing one does not change the next)', () => {
    const step = GUIDE_STEPS.find(s => s.id === 'expand')!;
    const a = step.scenario();
    const target = getLegalExpansionTargets(a)[0];
    gameReducer(a, { type: 'EXPAND', cellId: target });
    expect(step.scenario().board[target].active).toBe(false);
  });
});
