import { describe, expect, it } from 'vitest';
import { getCellId } from '../utils';
import { activate, emptyGame, legalTargets, put, sq } from './helpers';

function withKings() {
  const state = emptyGame();
  put(state, 'KING', 'WHITE', sq('e1'));
  put(state, 'KING', 'BLACK', sq('e8'));
  return state;
}

describe('piece movement on a dynamic board', () => {
  it('pawns step one or two cells from their starting rank and capture diagonally', () => {
    const state = withKings();
    put(state, 'PAWN', 'WHITE', sq('c2'), false);
    put(state, 'PAWN', 'BLACK', sq('d3'));
    expect(legalTargets(state, sq('c2'))).toEqual([sq('c3'), sq('c4'), sq('d3')].sort());
  });

  it('a pawn that has moved only steps one cell', () => {
    const state = withKings();
    put(state, 'PAWN', 'WHITE', sq('c3'), true);
    expect(legalTargets(state, sq('c3'))).toEqual([sq('c4')]);
  });

  it('pawns cannot step onto or jump over an inactive cell', () => {
    const state = withKings();
    put(state, 'PAWN', 'WHITE', sq('a2'), false);
    state.board[sq('a3')].active = false; // a hole right in front of the pawn
    expect(legalTargets(state, sq('a2'))).toEqual([]);
  });

  it('a rook in the middle of the a-file sees 14 cells, none off the board', () => {
    const state = withKings();
    put(state, 'ROOK', 'WHITE', sq('a4'));
    expect(legalTargets(state, sq('a4'))).toHaveLength(14);
  });

  it('expanded cells extend sliding lines', () => {
    const state = withKings();
    put(state, 'ROOK', 'WHITE', sq('a4'));
    activate(state, getCellId(3, 7), getCellId(2, 7)); // two cells left of a4
    const targets = legalTargets(state, sq('a4'));
    expect(targets).toHaveLength(16);
    expect(targets).toContain(getCellId(2, 7));
  });

  it('sliders stop at an inactive gap even if active cells lie beyond it', () => {
    const state = withKings();
    put(state, 'ROOK', 'WHITE', sq('a4'));
    activate(state, getCellId(2, 7)); // (3,7) stays inactive
    expect(legalTargets(state, sq('a4'))).not.toContain(getCellId(2, 7));
  });

  it('knights jump over inactive cells but must land on an active one', () => {
    const state = withKings();
    put(state, 'KNIGHT', 'WHITE', sq('a4'));
    activate(state, getCellId(2, 8)); // isolated landing cell two files left, one rank up
    const targets = legalTargets(state, sq('a4'));
    expect(targets).toContain(getCellId(2, 8));
    expect(targets).not.toContain(getCellId(2, 6)); // inactive
  });

  it('pieces cannot capture their own side', () => {
    const state = withKings();
    put(state, 'ROOK', 'WHITE', sq('a1'));
    put(state, 'KNIGHT', 'WHITE', sq('a3'));
    const targets = legalTargets(state, sq('a1'));
    expect(targets).toContain(sq('a2'));
    expect(targets).not.toContain(sq('a3'));
    expect(targets).not.toContain(sq('a4'));
  });

  it('only the side to move has legal moves', () => {
    const state = withKings();
    put(state, 'ROOK', 'BLACK', sq('a8'));
    expect(legalTargets(state, sq('a8'))).toEqual([]);
  });
});
