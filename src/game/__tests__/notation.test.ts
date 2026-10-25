import { describe, expect, it } from 'vitest';
import { createInitialGameState, getCellId } from '../utils';
import { cellLabel } from '../notation';
import { emptyGame, play, put, sq } from './helpers';

describe('cell labels', () => {
  it('uses files a..p and ranks 1..16 on the full grid', () => {
    expect(cellLabel(getCellId(0, 0))).toBe('a1');
    expect(cellLabel(getCellId(15, 15))).toBe('p16');
    expect(cellLabel(sq('a1'))).toBe('e5'); // the starting board spans e5..l12
    expect(cellLabel(sq('h8'))).toBe('l12');
  });
});

describe('move notation', () => {
  it('writes pawn pushes, piece moves and pawn captures', () => {
    let state = createInitialGameState();
    state = play(state, sq('e2'), sq('e4'));
    state = play(state, sq('d7'), sq('d5'));
    state = play(state, sq('e4'), sq('d5'));
    state = play(state, sq('g8'), sq('f6'));
    expect(state.notation).toEqual(['i8', 'h9', 'ixh9', 'Nj10']);
  });

  it("marks captures by pieces with an 'x'", () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('h1'));
    put(state, 'KING', 'BLACK', sq('h8'));
    put(state, 'ROOK', 'WHITE', sq('a1'));
    put(state, 'KNIGHT', 'BLACK', sq('a5'));
    expect(play(state, sq('a1'), sq('a5')).notation).toEqual(['Rxe9']);
  });

  it("adds '+' for check", () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('h1'));
    put(state, 'KING', 'BLACK', sq('e8'));
    put(state, 'ROOK', 'WHITE', sq('a4'));
    expect(play(state, sq('a4'), sq('e4')).notation).toEqual(['Ri8+']);
  });

  it('adds the origin file when two identical pieces can reach the cell', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('a1'));
    put(state, 'KING', 'BLACK', sq('a8'));
    put(state, 'ROOK', 'WHITE', sq('b4'));
    put(state, 'ROOK', 'WHITE', sq('h4'));
    expect(play(state, sq('b4'), sq('e4')).notation).toEqual(['Rfi8']);
  });

  it('adds the origin rank when the identical pieces share a file', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('h1'));
    put(state, 'KING', 'BLACK', sq('h8'));
    put(state, 'ROOK', 'WHITE', sq('a2'));
    put(state, 'ROOK', 'WHITE', sq('a6'));
    expect(play(state, sq('a2'), sq('a4')).notation).toEqual(['R6e8']);
  });
});
