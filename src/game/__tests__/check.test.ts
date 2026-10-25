import { describe, expect, it } from 'vitest';
import { createInitialGameState, getCellId, getPieceAt } from '../utils';
import { getLegalExpansionTargets, getLegalMoves, isInCheck, isSquareAttacked } from '../engine';
import { gameReducer } from '../reducer';
import { activateAll, emptyGame, legalTargets, play, put, sq } from './helpers';

describe('check', () => {
  it('a pinned piece cannot move', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'KNIGHT', 'WHITE', sq('e2'));
    put(state, 'ROOK', 'BLACK', sq('e8'));
    put(state, 'KING', 'BLACK', sq('a8'));
    expect(legalTargets(state, sq('e2'))).toEqual([]);
  });

  it('when in check, only moves that resolve the check are legal', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'ROOK', 'WHITE', sq('a2'));
    put(state, 'ROOK', 'BLACK', sq('e8'));
    put(state, 'KING', 'BLACK', sq('a8'));
    expect(isInCheck(state, 'WHITE')).toBe(true);
    expect(legalTargets(state, sq('a2'))).toEqual([sq('e2')]); // only the block
  });

  it('the king cannot step onto an attacked cell', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'ROOK', 'BLACK', sq('d8'));
    put(state, 'KING', 'BLACK', sq('a8'));
    const targets = legalTargets(state, sq('e1'));
    expect(targets).not.toContain(sq('d1'));
    expect(targets).not.toContain(sq('d2'));
    expect(targets).toContain(sq('f1'));
  });

  it('pawns attack diagonally, not straight ahead', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('a1'));
    put(state, 'KING', 'BLACK', sq('a8'));
    put(state, 'PAWN', 'BLACK', sq('e5'));
    expect(isSquareAttacked(state, sq('d4'), 'BLACK')).toBe(true);
    expect(isSquareAttacked(state, sq('f4'), 'BLACK')).toBe(true);
    expect(isSquareAttacked(state, sq('e4'), 'BLACK')).toBe(false);
  });

  it('an expansion can never be used to ignore a check', () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'ROOK', 'BLACK', sq('e8'));
    put(state, 'KING', 'BLACK', sq('a8'));
    expect(getLegalExpansionTargets(state)).toEqual([]);
    expect(gameReducer(state, { type: 'EXPAND', cellId: getCellId(3, 4) })).toBe(state);
  });

  it('regression: a king can no longer be captured after its owner expands instead of answering check', () => {
    let state = createInitialGameState();
    state = play(state, sq('f2'), sq('f3'));
    state = play(state, sq('e7'), sq('e5'));
    state = gameReducer(state, { type: 'EXPAND', cellId: getCellId(3, 4) });
    state = play(state, sq('d8'), sq('h4')); // Qh4+
    expect(isInCheck(state, 'WHITE')).toBe(true);
    expect(state.status).toBe('ONGOING'); // g2-g3 blocks, so not mate

    // White may not expand; every legal reply leaves the king safe
    expect(gameReducer(state, { type: 'EXPAND', cellId: getCellId(3, 5) })).toBe(state);
    const replies = Object.values(state.pieces)
      .filter(p => p.owner === 'WHITE')
      .flatMap(p => getLegalMoves(state, p.id));
    expect(replies.length).toBeGreaterThan(0);
    for (const reply of replies) {
      const next = gameReducer(state, reply);
      expect(isInCheck(next, 'WHITE')).toBe(false);
      expect(Object.values(next.pieces).some(p => p.type === 'KING' && p.owner === 'WHITE')).toBe(true);
    }
  });
});

describe('castling', () => {
  function castlingSetup() {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'), false);
    put(state, 'ROOK', 'WHITE', sq('h1'), false);
    put(state, 'ROOK', 'WHITE', sq('a1'), false);
    put(state, 'KING', 'BLACK', sq('e8'));
    return state;
  }

  it('castles kingside: king to g1, rook to f1', () => {
    const next = play(castlingSetup(), sq('e1'), sq('g1'));
    expect(getPieceAt(next, sq('g1'))).toMatchObject({ type: 'KING' });
    expect(getPieceAt(next, sq('f1'))).toMatchObject({ type: 'ROOK' });
    expect(getPieceAt(next, sq('h1'))).toBeUndefined();
    expect(next.notation).toEqual(['O-O']);
  });

  it('castles queenside: king to c1, rook to d1', () => {
    const next = play(castlingSetup(), sq('e1'), sq('c1'));
    expect(getPieceAt(next, sq('c1'))).toMatchObject({ type: 'KING' });
    expect(getPieceAt(next, sq('d1'))).toMatchObject({ type: 'ROOK' });
    expect(getPieceAt(next, sq('a1'))).toBeUndefined();
    expect(next.notation).toEqual(['O-O-O']);
  });

  it('is not allowed after the king has moved', () => {
    const state = castlingSetup();
    getPieceAt(state, sq('e1'))!.hasMoved = true;
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('g1'));
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('c1'));
  });

  it('is not allowed with a rook that has moved', () => {
    const state = castlingSetup();
    getPieceAt(state, sq('h1'))!.hasMoved = true;
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('g1'));
    expect(legalTargets(state, sq('e1'))).toContain(sq('c1'));
  });

  it('is not allowed through pieces', () => {
    const state = castlingSetup();
    put(state, 'KNIGHT', 'WHITE', sq('b1'));
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('c1'));
  });

  it('is not allowed out of check', () => {
    const state = castlingSetup();
    put(state, 'ROOK', 'BLACK', sq('e7'));
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('g1'));
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('c1'));
  });

  it('is not allowed through a cell attacked by a pawn (diagonal attack)', () => {
    const state = castlingSetup();
    put(state, 'PAWN', 'BLACK', sq('g2')); // attacks f1 and h1, not e1 or g1
    expect(isInCheck(state, 'WHITE')).toBe(false);
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('g1'));
  });

  it('is not allowed onto an attacked cell', () => {
    const state = castlingSetup();
    put(state, 'ROOK', 'BLACK', sq('g8'));
    expect(legalTargets(state, sq('e1'))).not.toContain(sq('g1'));
  });
});

describe('end of game', () => {
  it("fool's mate is checkmate (expansions cannot save the king)", () => {
    let state = createInitialGameState();
    state = play(state, sq('f2'), sq('f3'));
    state = play(state, sq('e7'), sq('e5'));
    state = play(state, sq('g2'), sq('g4'));
    state = play(state, sq('d8'), sq('h4'));
    expect(state.status).toBe('BLACK_WIN');
    expect(state.endReason).toBe('CHECKMATE');
    expect(state.notation.at(-1)).toBe('Ql8#');
    // Nothing is accepted after the game has ended
    expect(gameReducer(state, { type: 'EXPAND', cellId: getCellId(3, 4) })).toBe(state);
  });

  it('no legal move but an expansion available: the game goes on and the player must expand', () => {
    const state = emptyGame();
    put(state, 'KING', 'BLACK', sq('a8'));
    put(state, 'QUEEN', 'WHITE', sq('c3'));
    put(state, 'KING', 'WHITE', sq('h1'));
    const next = play(state, sq('c3'), sq('c7')); // black king boxed in, not in check

    expect(next.status).toBe('ONGOING');
    expect(next.currentPlayer).toBe('BLACK');
    expect(Object.values(next.pieces).filter(p => p.owner === 'BLACK').flatMap(p => getLegalMoves(next, p.id))).toEqual([]);
    expect(getLegalExpansionTargets(next).length).toBeGreaterThan(0);

    const afterExpand = gameReducer(next, { type: 'EXPAND', cellId: getCellId(3, 10) });
    expect(afterExpand).not.toBe(next);
    expect(afterExpand.currentPlayer).toBe('WHITE');
  });

  it('no legal move and no cell left to expand is stalemate (draw)', () => {
    const state = emptyGame();
    activateAll(state); // the whole 16x16 grid is already in play
    put(state, 'KING', 'BLACK', getCellId(0, 15));
    put(state, 'QUEEN', 'WHITE', getCellId(2, 10));
    put(state, 'KING', 'WHITE', getCellId(8, 4));
    const next = play(state, getCellId(2, 10), getCellId(2, 14));
    expect(next.status).toBe('DRAW');
    expect(next.endReason).toBe('STALEMATE');
  });
});
