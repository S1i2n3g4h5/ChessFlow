import { describe, expect, it } from 'vitest';
import { getCellId, getPieceAt } from '../utils';
import { getLegalMoves, isPromotionMove } from '../engine';
import { gameReducer } from '../reducer';
import { activate, emptyGame, expand, play, put, sq } from './helpers';

function baseGame() {
  const state = emptyGame();
  put(state, 'KING', 'WHITE', sq('h1'));
  put(state, 'KING', 'BLACK', sq('h8'));
  return state;
}

describe('pawn promotion', () => {
  it('offers all four promotion pieces on the farthest active rank', () => {
    const state = baseGame();
    const pawn = put(state, 'PAWN', 'WHITE', sq('a7'));
    const moves = getLegalMoves(state, pawn);
    expect(moves.map(m => m.promotionTo).sort()).toEqual(['BISHOP', 'KNIGHT', 'QUEEN', 'ROOK']);
    expect(moves.every(m => m.toCellId === sq('a8'))).toBe(true);
  });

  it('turns the pawn into the chosen piece and records it', () => {
    const state = baseGame();
    put(state, 'PAWN', 'WHITE', sq('a7'));
    const next = play(state, sq('a7'), sq('a8'), 'KNIGHT');
    expect(getPieceAt(next, sq('a8'))).toMatchObject({ type: 'KNIGHT', owner: 'WHITE' });
    expect(next.notation).toEqual(['e12=N']);
  });

  it('rejects a move onto the promotion rank without a promotion choice', () => {
    const state = baseGame();
    const pawn = put(state, 'PAWN', 'WHITE', sq('a7'));
    expect(gameReducer(state, { type: 'MOVE', pieceId: pawn, toCellId: sq('a8') })).toBe(state);
  });

  it('promotes black pawns on their own farthest rank', () => {
    const state = baseGame();
    state.currentPlayer = 'BLACK';
    put(state, 'PAWN', 'BLACK', sq('a2'));
    const next = play(state, sq('a2'), sq('a1'), 'QUEEN');
    expect(getPieceAt(next, sq('a1'))).toMatchObject({ type: 'QUEEN', owner: 'BLACK' });
  });

  it('an expansion beyond the last rank pushes that column\'s promotion line back', () => {
    let state = baseGame();
    state.currentPlayer = 'BLACK';
    put(state, 'PAWN', 'WHITE', sq('a6'));

    state = expand(state, getCellId(4, 12)); // Black grows the a-file by one cell
    expect(isPromotionMove(state, getPieceAt(state, sq('a6'))!.id, sq('a7'))).toBe(false);

    state = play(state, sq('a6'), sq('a7'));
    state = play(state, sq('h8'), sq('g8'));
    state = play(state, sq('a7'), sq('a8')); // the old last rank is no longer a promotion
    expect(getPieceAt(state, sq('a8'))).toMatchObject({ type: 'PAWN' });

    state = play(state, sq('g8'), sq('h8'));
    state = play(state, sq('a8'), getCellId(4, 12), 'QUEEN');
    expect(getPieceAt(state, getCellId(4, 12))).toMatchObject({ type: 'QUEEN' });
  });

  it('decides promotion by the column the pawn lands in (capture into a longer column)', () => {
    const state = baseGame();
    activate(state, getCellId(5, 12)); // the b-file is one cell longer than the a-file
    const pawn = put(state, 'PAWN', 'WHITE', sq('a7'));
    put(state, 'KNIGHT', 'BLACK', sq('b8'));

    const moves = getLegalMoves(state, pawn);
    const capture = moves.filter(m => m.toCellId === sq('b8'));
    const push = moves.filter(m => m.toCellId === sq('a8'));
    expect(capture).toHaveLength(1);
    expect(capture[0].promotionTo).toBeUndefined();
    expect(push).toHaveLength(4);
  });

  it('decides promotion by the column the pawn lands in (capture into a shorter column)', () => {
    const state = baseGame();
    activate(state, getCellId(5, 12));
    const pawn = put(state, 'PAWN', 'WHITE', sq('b7'));
    put(state, 'KNIGHT', 'BLACK', sq('a8'));

    const moves = getLegalMoves(state, pawn);
    expect(moves.filter(m => m.toCellId === sq('a8'))).toHaveLength(4); // promotes
    expect(moves.filter(m => m.toCellId === sq('b8'))).toEqual([
      { type: 'MOVE', pieceId: pawn, toCellId: sq('b8') },
    ]); // does not promote
  });
});
