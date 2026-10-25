import { describe, expect, it } from 'vitest';
import { GameState, TurnAction } from '../../types';
import { createInitialGameState } from '../../utils';
import { getLegalExpansionTargets, getLegalMoves, isInCheck } from '../../engine';
import { gameReducer } from '../../reducer';
import { Position, toTurnAction } from '../position';
import { activateAll, emptyGame, put, seededRandom, sq } from '../../__tests__/helpers';

/** Canonical text for an action so two engines' outputs can be compared as sets. */
function key(a: TurnAction): string {
  if (a.type === 'EXPAND') return `X ${a.cellId}`;
  if (a.type === 'MOVE') return `M ${a.pieceId} ${a.toCellId} ${a.promotionTo ?? ''} ${a.isCastling ?? ''}`;
  return a.type;
}

function referenceActions(state: GameState): string[] {
  const moves = Object.values(state.pieces)
    .filter(p => p.owner === state.currentPlayer)
    .flatMap(p => getLegalMoves(state, p.id));
  const exps = getLegalExpansionTargets(state).map(cellId => ({ type: 'EXPAND' as const, cellId }));
  return [...moves, ...exps].map(key).sort();
}

function fastActions(state: GameState): string[] {
  const pos = Position.fromGameState(state);
  return pos.legalActions().map(m => key(toTurnAction(state, m))).sort();
}

function expectSameRules(state: GameState) {
  expect(fastActions(state)).toEqual(referenceActions(state));
  const pos = Position.fromGameState(state);
  expect(pos.inCheck(pos.side)).toBe(isInCheck(state, state.currentPlayer));
}

describe('fast AI engine agrees with the reference rules engine', () => {
  it('on the starting position', () => {
    expectSameRules(createInitialGameState());
  });

  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    it(`on every position of random game #${seed}`, () => {
      const random = seededRandom(seed);
      let state = createInitialGameState();
      for (let ply = 0; ply < 90 && state.status === 'ONGOING'; ply++) {
        expectSameRules(state);
        const moves = Object.values(state.pieces).filter(p => p.owner === state.currentPlayer).flatMap(p => getLegalMoves(state, p.id));
        const exps = getLegalExpansionTargets(state).map(cellId => ({ type: 'EXPAND' as const, cellId }));
        // Lots of expansions and captures, so stabilization, holes and promotion lines all get exercised
        const pool: TurnAction[] = random() < 0.35 && exps.length ? exps : moves.length ? moves : exps;
        const captures = (pool as TurnAction[]).filter(a => a.type === 'MOVE' && Object.values(state.pieces).some(p => p.cellId === a.toCellId));
        const pick = captures.length && random() < 0.5 ? captures : pool;
        state = gameReducer(state, pick[Math.floor(random() * pick.length)]);
      }
    }, 60_000); // ~90 positions through the (deliberately simple, slower) reference engine
  }

  it('make/unmake restores the position exactly (hash included)', () => {
    const random = seededRandom(99);
    let state = createInitialGameState();
    for (let i = 0; i < 30; i++) {
      const pos = Position.fromGameState(state);
      const before = { board: [...pos.board], active: [...pos.active], stab: [...pos.stab], moved: [...pos.moved], hash: [pos.hashLo, pos.hashHi], side: pos.side };
      for (const m of pos.legalActions()) {
        pos.make(m);
        pos.unmake();
      }
      expect({ board: [...pos.board], active: [...pos.active], stab: [...pos.stab], moved: [...pos.moved], hash: [pos.hashLo, pos.hashHi], side: pos.side }).toEqual(before);
      const actions = pos.legalActions();
      state = gameReducer(state, toTurnAction(state, actions[Math.floor(random() * actions.length)]));
    }
  });

  it('incremental hash equals a freshly computed hash after every move', () => {
    const random = seededRandom(5);
    let state = createInitialGameState();
    const pos = Position.fromGameState(state);
    for (let i = 0; i < 40 && state.status === 'ONGOING'; i++) {
      const actions = pos.legalActions();
      const m = actions[Math.floor(random() * actions.length)];
      const action = toTurnAction(state, m);
      pos.make(m);
      state = gameReducer(state, action);
      const fresh = Position.fromGameState(state);
      expect([pos.hashLo, pos.hashHi]).toEqual([fresh.hashLo, fresh.hashHi]);
    }
  });

  it('on custom edge cases: castling, promotion lines, full grid, stabilizing cells', () => {
    const castle = emptyGame();
    put(castle, 'KING', 'WHITE', sq('e1'), false);
    put(castle, 'ROOK', 'WHITE', sq('h1'), false);
    put(castle, 'ROOK', 'WHITE', sq('a1'), false);
    put(castle, 'KING', 'BLACK', sq('e8'));
    put(castle, 'PAWN', 'BLACK', sq('g2')); // attacks f1: kingside castling is illegal
    expectSameRules(castle);

    const promo = emptyGame();
    put(promo, 'KING', 'WHITE', sq('h1'));
    put(promo, 'KING', 'BLACK', sq('h8'));
    put(promo, 'PAWN', 'WHITE', sq('a7'));
    put(promo, 'PAWN', 'WHITE', sq('b7'));
    put(promo, 'KNIGHT', 'BLACK', sq('a8'));
    promo.board['5,12'].active = true; // the b-file is one cell longer
    expectSameRules(promo);

    const full = emptyGame();
    activateAll(full);
    put(full, 'KING', 'WHITE', '0,0');
    put(full, 'QUEEN', 'WHITE', '7,7');
    put(full, 'KING', 'BLACK', '15,15');
    expectSameRules(full);

    const stab = emptyGame();
    put(stab, 'KING', 'WHITE', sq('e1'));
    put(stab, 'KING', 'BLACK', '8,12');
    put(stab, 'ROOK', 'WHITE', '4,12');
    for (const id of ['4,12', '5,12', '7,12', '8,12']) stab.board[id].active = true;
    const afterExpand = gameReducer(stab, { type: 'EXPAND', cellId: '6,12' }); // discovered check through a new cell
    expectSameRules(afterExpand);
  });
});
