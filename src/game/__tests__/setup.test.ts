import { describe, expect, it } from 'vitest';
import { createInitialGameState, getPieceAt, GRID_SIZE, INITIAL_CLOCK_SECONDS } from '../utils';
import { getLegalExpansionTargets, getLegalMoves } from '../engine';
import { sq } from './helpers';

describe('initial position', () => {
  const state = createInitialGameState();

  it('uses a 16x16 grid with only the central 8x8 active', () => {
    const cells = Object.values(state.board);
    expect(cells).toHaveLength(GRID_SIZE * GRID_SIZE);
    const active = cells.filter(c => c.active);
    expect(active).toHaveLength(64);
    for (const c of active) {
      expect(c.file).toBeGreaterThanOrEqual(4);
      expect(c.file).toBeLessThanOrEqual(11);
      expect(c.rank).toBeGreaterThanOrEqual(4);
      expect(c.rank).toBeLessThanOrEqual(11);
      expect(c.stabilizingUntil).toBeNull();
    }
  });

  it('places the standard chess army for both sides', () => {
    const pieces = Object.values(state.pieces);
    expect(pieces).toHaveLength(32);
    expect(pieces.filter(p => p.owner === 'WHITE')).toHaveLength(16);
    expect(pieces.filter(p => p.owner === 'BLACK')).toHaveLength(16);

    expect(getPieceAt(state, sq('e1'))).toMatchObject({ type: 'KING', owner: 'WHITE' });
    expect(getPieceAt(state, sq('d1'))).toMatchObject({ type: 'QUEEN', owner: 'WHITE' });
    expect(getPieceAt(state, sq('e8'))).toMatchObject({ type: 'KING', owner: 'BLACK' });
    expect(getPieceAt(state, sq('d8'))).toMatchObject({ type: 'QUEEN', owner: 'BLACK' });
    for (const file of 'abcdefgh') {
      expect(getPieceAt(state, sq(`${file}2`))).toMatchObject({ type: 'PAWN', owner: 'WHITE' });
      expect(getPieceAt(state, sq(`${file}7`))).toMatchObject({ type: 'PAWN', owner: 'BLACK' });
    }
  });

  it('starts White to move with empty history and full clocks', () => {
    expect(state.currentPlayer).toBe('WHITE');
    expect(state.status).toBe('ONGOING');
    expect(state.endReason).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.notation).toEqual([]);
    expect(state.version).toBe(0);
    expect(state.clocks).toEqual({ WHITE: INITIAL_CLOCK_SECONDS, BLACK: INITIAL_CLOCK_SECONDS });
  });

  it('gives White the same 20 opening moves as chess', () => {
    const total = Object.values(state.pieces)
      .filter(p => p.owner === 'WHITE')
      .reduce((sum, p) => sum + getLegalMoves(state, p.id).length, 0);
    expect(total).toBe(20);
  });

  it('offers 30 expansion cells: the 32-cell frontier minus the two cells touching a king', () => {
    const targets = getLegalExpansionTargets(state);
    expect(targets).toHaveLength(30);
    expect(targets).not.toContain('8,3'); // below the white king
    expect(targets).not.toContain('8,12'); // above the black king
  });

  it('gives each new game a different id', () => {
    expect(createInitialGameState().gameId).not.toBe(createInitialGameState().gameId);
  });
});
