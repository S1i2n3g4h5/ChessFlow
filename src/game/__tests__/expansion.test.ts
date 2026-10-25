import { describe, expect, it } from 'vitest';
import { createInitialGameState, getCellId } from '../utils';
import { getLegalExpansionTargets, getLegalMoves, isInCheck } from '../engine';
import { gameReducer } from '../reducer';
import { activate, emptyGame, expand, isActiveRegionConnected, legalTargets, play, put, seededRandom, sq } from './helpers';

describe('expansion targets', () => {
  const state = createInitialGameState();
  const targets = getLegalExpansionTargets(state);

  it('allows an inactive cell orthogonally adjacent to the board', () => {
    expect(targets).toContain(getCellId(3, 7)); // left of a4
    expect(targets).toContain(getCellId(7, 3)); // below d1 - only diagonal to the white king, so allowed
  });

  it('rejects corner cells that only touch the board diagonally', () => {
    expect(targets).not.toContain(getCellId(3, 3));
  });

  it('rejects cells that do not touch the board', () => {
    expect(targets).not.toContain(getCellId(2, 7));
  });

  it('rejects cells that are already active', () => {
    expect(targets).not.toContain(sq('a4'));
    expect(gameReducer(state, { type: 'EXPAND', cellId: sq('a4') })).toBe(state);
  });

  it('rejects unknown cell ids', () => {
    expect(gameReducer(state, { type: 'EXPAND', cellId: '99,99' })).toBe(state);
  });

  it('applies the king buffer to both kings, wherever they stand', () => {
    expect(targets).not.toContain(getCellId(8, 3));
    expect(targets).not.toContain(getCellId(8, 12));

    const s = emptyGame();
    put(s, 'KING', 'WHITE', sq('a4'));
    put(s, 'KING', 'BLACK', sq('h5'));
    const t = getLegalExpansionTargets(s);
    expect(t).not.toContain(getCellId(3, 7)); // left of the white king on a4
    expect(t).not.toContain(getCellId(12, 8)); // right of the black king on h5
    expect(t).toContain(getCellId(8, 3)); // e1's old buffer cell is free again
  });
});

describe('expanding', () => {
  it('uses up the turn and records the expansion', () => {
    const next = expand(createInitialGameState(), getCellId(3, 7));
    expect(next.currentPlayer).toBe('BLACK');
    expect(next.board[getCellId(3, 7)]).toMatchObject({ active: true, stabilizingUntil: 'WHITE' });
    expect(next.lastExpansion).toBe(getCellId(3, 7));
    expect(next.lastMove).toBeNull();
    expect(next.history).toEqual([{ type: 'EXPAND', cellId: getCellId(3, 7) }]);
    expect(next.notation).toEqual(['Exp d8']);
    expect(next.version).toBe(1);
  });

  it("blocks the opponent from a freshly placed cell until the placer's next turn", () => {
    let state = expand(createInitialGameState(), getCellId(7, 12)); // above Black's queen, diagonal to Black's king
    expect(legalTargets(state, sq('d8'))).not.toContain(getCellId(7, 12)); // queen
    expect(legalTargets(state, sq('e8'))).not.toContain(getCellId(7, 12)); // king

    state = play(state, sq('e7'), sq('e5')); // Black
    expect(state.board[getCellId(7, 12)].stabilizingUntil).toBeNull(); // cleared as White's turn starts
    state = play(state, sq('g1'), sq('f3')); // White
    expect(legalTargets(state, sq('d8'))).toContain(getCellId(7, 12)); // now usable by Black too
  });

  it("lets the placer's own pieces use the cell on their next turn", () => {
    let state = expand(createInitialGameState(), getCellId(3, 4)); // left of a1
    state = play(state, sq('e7'), sq('e5'));
    expect(legalTargets(state, sq('a1'))).toContain(getCellId(3, 4));
  });

  it("counts attacks through a stabilizing cell for the player who placed it (discovered check)", () => {
    const state = emptyGame();
    put(state, 'KING', 'WHITE', sq('e1'));
    put(state, 'KING', 'BLACK', getCellId(8, 12));
    put(state, 'ROOK', 'WHITE', getCellId(4, 12));
    // A row above the board with one gap at (6,12)
    activate(state, getCellId(4, 12), getCellId(5, 12), getCellId(7, 12), getCellId(8, 12));
    expect(isInCheck(state, 'BLACK')).toBe(false);

    const next = expand(state, getCellId(6, 12)); // closes the gap: the rook now sees the king
    expect(isInCheck(next, 'BLACK')).toBe(true);
    expect(next.notation).toEqual(['Exp g13+']);

    // Black cannot use the new cell to block, and cannot step into the rook's line
    const kingMoves = legalTargets(next, getCellId(8, 12));
    expect(kingMoves).not.toContain(getCellId(7, 12));
    expect(kingMoves.length).toBeGreaterThan(0);
    for (const piece of Object.values(next.pieces).filter(p => p.owner === 'BLACK')) {
      for (const m of getLegalMoves(next, piece.id)) {
        expect(isInCheck(gameReducer(next, m), 'BLACK')).toBe(false);
      }
    }
  });

  it('keeps the board one connected region and never grows past the 16x16 grid', () => {
    const random = seededRandom(42);
    let state = createInitialGameState();
    let expansions = 0;
    for (;;) {
      const targets = getLegalExpansionTargets(state);
      if (targets.length === 0) break;
      state = expand(state, targets[Math.floor(random() * targets.length)]);
      expansions++;
      expect(isActiveRegionConnected(state)).toBe(true);
    }
    // 256 cells minus the 64 starting ones, minus the 2 off-board cells touching a king (below e1, above e8)
    expect(expansions).toBe(256 - 64 - 2);
    expect(Object.values(state.board).filter(c => c.active)).toHaveLength(254);
  });
});
