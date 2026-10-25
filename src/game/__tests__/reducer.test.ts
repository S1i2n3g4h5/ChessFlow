import { describe, expect, it } from 'vitest';
import { createInitialGameState, getCellId, getPieceAt } from '../utils';
import { gameReducer } from '../reducer';
import { reconstructState } from '../playback';
import { GameState } from '../types';
import { expand, play, sq } from './helpers';

describe('gameReducer', () => {
  it('returns the same state for an illegal move: no version bump, nothing logged', () => {
    const state = createInitialGameState();
    const pawn = getPieceAt(state, sq('e2'))!;
    const next = gameReducer(state, { type: 'MOVE', pieceId: pawn.id, toCellId: sq('e5') });
    expect(next).toBe(state);
    expect(next.version).toBe(0);
    expect(next.history).toEqual([]);
  });

  it("rejects moving the opponent's pieces", () => {
    const state = createInitialGameState();
    const blackPawn = getPieceAt(state, sq('e7'))!;
    expect(gameReducer(state, { type: 'MOVE', pieceId: blackPawn.id, toCellId: sq('e5') })).toBe(state);
  });

  it('rejects unknown pieces and forged castling flags', () => {
    const state = createInitialGameState();
    expect(gameReducer(state, { type: 'MOVE', pieceId: 'nope', toCellId: sq('e4') })).toBe(state);
    const king = getPieceAt(state, sq('e1'))!;
    expect(gameReducer(state, { type: 'MOVE', pieceId: king.id, toCellId: sq('g1'), isCastling: 'KINGSIDE' })).toBe(state);
  });

  it('does not mutate the previous state', () => {
    const state = createInitialGameState();
    const snapshot = structuredClone(state);
    play(state, sq('e2'), sq('e4'));
    expect(state).toEqual(snapshot);
  });

  it('alternates turns and keeps history and notation in step', () => {
    let state = createInitialGameState();
    state = play(state, sq('e2'), sq('e4'));
    state = expand(state, getCellId(3, 7));
    state = play(state, sq('g1'), sq('f3'));
    expect(state.currentPlayer).toBe('BLACK');
    expect(state.history.map(a => a.type)).toEqual(['MOVE', 'EXPAND', 'MOVE']);
    expect(state.notation).toEqual(['i8', 'Exp d8', 'Nj7']);
    expect(state.version).toBe(3);
  });

  it('tracks the last move / last expansion highlight', () => {
    let state = play(createInitialGameState(), sq('e2'), sq('e4'));
    expect(state.lastMove).toEqual({ from: sq('e2'), to: sq('e4'), pieceType: 'PAWN' });
    expect(state.lastExpansion).toBeNull();
    state = expand(state, getCellId(3, 7));
    expect(state.lastMove).toBeNull();
    expect(state.lastExpansion).toBe(getCellId(3, 7));
  });

  it('counts half-moves since the last capture or pawn move', () => {
    let state = createInitialGameState();
    state = play(state, sq('g1'), sq('f3'));
    expect(state.halfMoveClock).toBe(1);
    state = expand(state, getCellId(3, 7));
    expect(state.halfMoveClock).toBe(2);
    state = play(state, sq('e2'), sq('e4'));
    expect(state.halfMoveClock).toBe(0);
  });

  describe('SET_NAME', () => {
    it('stores the name without touching the move history', () => {
      const state = gameReducer(createInitialGameState(), { type: 'SET_NAME', player: 'WHITE', name: '  AMAN  ' });
      expect(state.names.WHITE).toBe('AMAN');
      expect(state.history).toEqual([]);
      expect(state.notation).toEqual([]);
      expect(state.version).toBe(1);
      expect(state.currentPlayer).toBe('WHITE');
    });

    it('ignores empty names and repeats of the current name', () => {
      const state = gameReducer(createInitialGameState(), { type: 'SET_NAME', player: 'BLACK', name: 'ZEN' });
      expect(gameReducer(state, { type: 'SET_NAME', player: 'BLACK', name: 'ZEN' })).toBe(state);
      expect(gameReducer(state, { type: 'SET_NAME', player: 'BLACK', name: '   ' })).toBe(state);
    });

    it('limits names to 16 characters', () => {
      const state = gameReducer(createInitialGameState(), { type: 'SET_NAME', player: 'WHITE', name: 'A'.repeat(40) });
      expect(state.names.WHITE).toHaveLength(16);
    });
  });

  describe('READY', () => {
    it('marks a player as ready, once', () => {
      const state = gameReducer(createInitialGameState(), { type: 'READY', player: 'BLACK' });
      expect(state.ready).toEqual({ WHITE: false, BLACK: true });
      expect(gameReducer(state, { type: 'READY', player: 'BLACK' })).toBe(state);
      expect(state.history).toEqual([]);
    });
  });

  describe('RESIGN (Abandon Protocol)', () => {
    it('ends the game in favour of the opponent', () => {
      const state = gameReducer(createInitialGameState(), { type: 'RESIGN', player: 'WHITE' });
      expect(state.status).toBe('BLACK_WIN');
      expect(state.endReason).toBe('RESIGNATION');
    });

    it('works even when it is not your turn', () => {
      const state = gameReducer(createInitialGameState(), { type: 'RESIGN', player: 'BLACK' });
      expect(state.status).toBe('WHITE_WIN');
    });

    it('freezes the game afterwards', () => {
      const state = gameReducer(createInitialGameState(), { type: 'RESIGN', player: 'BLACK' });
      const pawn = getPieceAt(state, sq('e2'))!;
      expect(gameReducer(state, { type: 'MOVE', pieceId: pawn.id, toCellId: sq('e4') })).toBe(state);
      expect(gameReducer(state, { type: 'RESIGN', player: 'WHITE' })).toBe(state);
    });
  });
});

describe('playback', () => {
  function playSampleGame(): GameState[] {
    const states = [createInitialGameState()];
    const push = (s: GameState) => states.push(s);
    push(play(states.at(-1)!, sq('e2'), sq('e4')));
    push(expand(states.at(-1)!, getCellId(7, 12)));
    push(play(states.at(-1)!, sq('d2'), sq('d4')));
    push(play(states.at(-1)!, sq('d8'), getCellId(7, 12)));
    push(play(states.at(-1)!, sq('e4'), sq('e5')));
    return states;
  }

  it('reconstructs every position of the game from its history', () => {
    const states = playSampleGame();
    const final = states.at(-1)!;
    for (let i = -1; i < final.history.length; i++) {
      const rebuilt = reconstructState(final.history, i);
      const expected = states[i + 1];
      expect(rebuilt.pieces).toEqual(expected.pieces);
      expect(rebuilt.board).toEqual(expected.board);
      expect(rebuilt.currentPlayer).toBe(expected.currentPlayer);
      expect(rebuilt.notation).toEqual(expected.notation);
    }
  });

  it('index -1 is the starting position', () => {
    const final = playSampleGame().at(-1)!;
    expect(reconstructState(final.history, -1).pieces).toEqual(createInitialGameState().pieces);
  });

  it('clamps an index past the end of the history to the live position', () => {
    const final = playSampleGame().at(-1)!;
    expect(reconstructState(final.history, 99).pieces).toEqual(final.pieces);
  });
});
