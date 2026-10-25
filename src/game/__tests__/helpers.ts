import { GameState, PieceType, PlayerColor } from '../types';
import { BOARD_START, createInitialGameState, getCellId, getPieceAt, GRID_SIZE, parseCellId } from '../utils';
import { getLegalMoves } from '../engine';
import { gameReducer } from '../reducer';

/**
 * Standard chess square on the starting 8x8 board -> grid cell id.
 * 'a1' is (4,4) and 'h8' is (11,11) on the 16x16 grid.
 */
export function sq(name: string): string {
  const file = name.charCodeAt(0) - 'a'.charCodeAt(0) + BOARD_START;
  const rank = Number(name.slice(1)) - 1 + BOARD_START;
  return getCellId(file, rank);
}

/** Starting board (central 8x8 active) with no pieces on it. */
export function emptyGame(currentPlayer: PlayerColor = 'WHITE'): GameState {
  const state = createInitialGameState();
  state.pieces = {};
  state.currentPlayer = currentPlayer;
  return state;
}

let pieceCounter = 0;

export function put(state: GameState, type: PieceType, owner: PlayerColor, cellId: string, hasMoved = true): string {
  const id = `${owner === 'WHITE' ? 'w' : 'b'}_${type}_t${pieceCounter++}`;
  state.pieces[id] = { id, owner, type, cellId, hasMoved };
  return id;
}

export function activate(state: GameState, ...cellIds: string[]): void {
  for (const id of cellIds) state.board[id].active = true;
}

export function activateAll(state: GameState): void {
  for (const cell of Object.values(state.board)) cell.active = true;
}

/** Plays the legal move from `from` to `to` (with optional promotion) and fails loudly if it is illegal. */
export function play(state: GameState, from: string, to: string, promotionTo?: PieceType): GameState {
  const piece = getPieceAt(state, from);
  if (!piece) throw new Error(`No piece on ${from}`);
  const move = getLegalMoves(state, piece.id).find(m => m.toCellId === to && m.promotionTo === promotionTo);
  if (!move) throw new Error(`Illegal move ${from} -> ${to}`);
  const next = gameReducer(state, move);
  if (next === state) throw new Error(`Reducer rejected ${from} -> ${to}`);
  return next;
}

export function expand(state: GameState, cellId: string): GameState {
  const next = gameReducer(state, { type: 'EXPAND', cellId });
  if (next === state) throw new Error(`Expansion rejected at ${cellId}`);
  return next;
}

export function legalTargets(state: GameState, from: string): string[] {
  const piece = getPieceAt(state, from);
  if (!piece) return [];
  return [...new Set(getLegalMoves(state, piece.id).map(m => m.toCellId))].sort();
}

/** Every active cell can be reached from every other one through orthogonal steps. */
export function isActiveRegionConnected(state: GameState): boolean {
  const active = Object.values(state.board).filter(c => c.active).map(c => c.id);
  if (active.length === 0) return true;
  const seen = new Set<string>([active[0]]);
  const queue = [active[0]];
  while (queue.length) {
    const [f, r] = parseCellId(queue.pop()!);
    for (const [df, dr] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nr < 0 || nf >= GRID_SIZE || nr >= GRID_SIZE) continue;
      const id = getCellId(nf, nr);
      if (state.board[id].active && !seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return seen.size === active.length;
}

/** Small deterministic PRNG (mulberry32) so randomized tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
