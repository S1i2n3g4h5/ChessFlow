import { GameState, PieceType, PlayerColor, TurnAction } from '../types';
import { getCellId, getPieceAt } from '../utils';

/**
 * Fast, mutable mirror of the rules engine for the computer opponent.
 *
 * The reference engine (engine.ts) clones the whole game for every candidate move, which is
 * fine for a human game but far too slow for a search that visits hundreds of thousands of
 * positions. This class keeps the board in typed arrays and supports make/unmake.
 * It must agree with engine.ts on every legal action - see ai/__tests__/equivalence.test.ts.
 *
 * Squares: sq = rank * 16 + file. Pieces: + White / - Black, |code| = P1 N2 B3 R4 Q5 K6.
 */

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export type Side = 1 | -1;

const TYPE_TO_CODE: Record<PieceType, number> = { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING };
const CODE_TO_TYPE: PieceType[] = ['PAWN', 'PAWN', 'KNIGHT', 'BISHOP', 'ROOK', 'QUEEN', 'KING'];

// ---- Move encoding: from | to << 8 | promo << 16 | castle << 20 | expand << 23 ----
export const FLAG_EXPAND = 1 << 23;
export const moveFrom = (m: number) => m & 0xff;
export const moveTo = (m: number) => (m >> 8) & 0xff;
export const movePromo = (m: number) => (m >> 16) & 0x7;
export const moveCastle = (m: number) => (m >> 20) & 0x3; // 1 kingside, 2 queenside
export const isExpansion = (m: number) => (m & FLAG_EXPAND) !== 0;
const encode = (from: number, to: number, promo = 0, castle = 0) => from | (to << 8) | (promo << 16) | (castle << 20);
export const encodeExpansion = (cell: number) => (cell << 8) | FLAG_EXPAND;

// ---- Geometry tables ----
const fileOf = (sq: number) => sq & 15;
const rankOf = (sq: number) => sq >> 4;
const inGrid = (f: number, r: number) => f >= 0 && f < 16 && r >= 0 && r < 16;

const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];
const KNIGHT_STEPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

export const RAYS: number[][][] = [];
export const KNIGHT_TARGETS: number[][] = [];
export const KING_TARGETS: number[][] = [];
export const ORTHO_NEIGHBORS: number[][] = [];
for (let sq = 0; sq < 256; sq++) {
  const f = fileOf(sq), r = rankOf(sq);
  RAYS[sq] = DIRS.map(([df, dr]) => {
    const ray: number[] = [];
    for (let k = 1; inGrid(f + df * k, r + dr * k); k++) ray.push((r + dr * k) * 16 + f + df * k);
    return ray;
  });
  KNIGHT_TARGETS[sq] = KNIGHT_STEPS.filter(([df, dr]) => inGrid(f + df, r + dr)).map(([df, dr]) => (r + dr) * 16 + f + df);
  KING_TARGETS[sq] = DIRS.filter(([df, dr]) => inGrid(f + df, r + dr)).map(([df, dr]) => (r + dr) * 16 + f + df);
  ORTHO_NEIGHBORS[sq] = DIRS.slice(0, 4).filter(([df, dr]) => inGrid(f + df, r + dr)).map(([df, dr]) => (r + dr) * 16 + f + df);
}

// ---- Zobrist hashing (two 32-bit halves) ----
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const rand = makeRandom(20261024);
const table = (n: number) => { const t = new Uint32Array(n); for (let i = 0; i < n; i++) t[i] = rand(); return t; };
// piece key index: ((code + 6) * 2 + moved) * 256 + sq
const Z_PIECE_LO = table(13 * 2 * 256), Z_PIECE_HI = table(13 * 2 * 256);
const Z_ACTIVE_LO = table(256), Z_ACTIVE_HI = table(256);
const Z_STAB_LO = table(512), Z_STAB_HI = table(512);
const Z_SIDE_LO = rand(), Z_SIDE_HI = rand();
const pieceKey = (code: number, moved: number, sq: number) => ((code + 6) * 2 + moved) * 256 + sq;
const stabKey = (owner: number, sq: number) => (owner === 1 ? 0 : 256) + sq;

interface Undo {
  move: number;
  captured: number;
  capturedMoved: number;
  fromMoved: number;
  hashLo: number;
  hashHi: number;
  kingW: number;
  kingB: number;
  cleared: number[];   // stabilizing cells cleared when the turn passed
  colMax: number;      // previous column bounds (expansions only)
  colMin: number;
}

export class Position {
  readonly board = new Int8Array(256);
  readonly active = new Uint8Array(256);
  readonly stab = new Int8Array(256);     // owner (1/-1) of a stabilizing cell, 0 otherwise
  readonly moved = new Uint8Array(256);   // hasMoved of the piece standing on the square
  readonly colMax = new Int8Array(16);    // highest active rank per file (-1 = none)
  readonly colMin = new Int8Array(16);    // lowest active rank per file (16 = none)
  side: Side = 1;
  kingW = -1;
  kingB = -1;
  hashLo = 0;
  hashHi = 0;
  private stabList: number[] = [];
  private undos: Undo[] = [];

  static fromGameState(state: GameState): Position {
    const pos = new Position();
    pos.colMax.fill(-1);
    pos.colMin.fill(16);
    for (const cell of Object.values(state.board)) {
      const sq = cell.rank * 16 + cell.file;
      if (cell.active) {
        pos.active[sq] = 1;
        pos.colMax[cell.file] = Math.max(pos.colMax[cell.file], cell.rank);
        pos.colMin[cell.file] = Math.min(pos.colMin[cell.file], cell.rank);
      }
      if (cell.stabilizingUntil) {
        pos.stab[sq] = cell.stabilizingUntil === 'WHITE' ? 1 : -1;
        pos.stabList.push(sq);
      }
    }
    for (const piece of Object.values(state.pieces)) {
      const [f, r] = piece.cellId.split(',').map(Number);
      const sq = r * 16 + f;
      const code = TYPE_TO_CODE[piece.type] * (piece.owner === 'WHITE' ? 1 : -1);
      pos.board[sq] = code;
      pos.moved[sq] = piece.hasMoved ? 1 : 0;
      if (code === KING) pos.kingW = sq;
      if (code === -KING) pos.kingB = sq;
    }
    pos.side = state.currentPlayer === 'WHITE' ? 1 : -1;
    pos.computeHash();
    return pos;
  }

  private computeHash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 256; sq++) {
      if (this.active[sq]) { lo ^= Z_ACTIVE_LO[sq]; hi ^= Z_ACTIVE_HI[sq]; }
      if (this.stab[sq]) { const k = stabKey(this.stab[sq], sq); lo ^= Z_STAB_LO[k]; hi ^= Z_STAB_HI[k]; }
      const p = this.board[sq];
      if (p) { const k = pieceKey(p, this.moved[sq], sq); lo ^= Z_PIECE_LO[k]; hi ^= Z_PIECE_HI[k]; }
    }
    if (this.side === -1) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;
  }

  private togglePiece(code: number, moved: number, sq: number) {
    const k = pieceKey(code, moved, sq);
    this.hashLo = (this.hashLo ^ Z_PIECE_LO[k]) >>> 0;
    this.hashHi = (this.hashHi ^ Z_PIECE_HI[k]) >>> 0;
  }

  /** Same rule as isCellUsableBy: active, and not stabilizing for the other side. */
  usable(sq: number, c: Side): boolean {
    return this.active[sq] === 1 && (this.stab[sq] === 0 || this.stab[sq] === c);
  }

  kingOf(c: Side): number {
    return c === 1 ? this.kingW : this.kingB;
  }

  /** Mirrors pieceAttacksSquare / isSquareAttacked in engine.ts. */
  isAttacked(sq: number, by: Side): boolean {
    if (sq < 0 || !this.usable(sq, by)) return false;
    const b = this.board;
    const f = fileOf(sq), r = rankOf(sq);

    const pr = r - by; // a pawn of `by` one rank "behind" sq attacks it diagonally
    if (pr >= 0 && pr < 16) {
      if (f > 0 && b[pr * 16 + f - 1] === by * PAWN) return true;
      if (f < 15 && b[pr * 16 + f + 1] === by * PAWN) return true;
    }
    for (const t of KNIGHT_TARGETS[sq]) if (b[t] === by * KNIGHT) return true;
    for (const t of KING_TARGETS[sq]) if (b[t] === by * KING) return true;

    const rays = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      const slider = d < 4 ? ROOK : BISHOP;
      for (const t of rays[d]) {
        const p = b[t];
        if (p !== 0) {
          if (p === by * slider || p === by * QUEEN) return true;
          break;
        }
        if (!this.usable(t, by)) break;
      }
    }
    return false;
  }

  inCheck(c: Side): boolean {
    const k = this.kingOf(c);
    return k >= 0 && this.isAttacked(k, -c as Side);
  }

  private isPromotionSquare(to: number, c: Side): boolean {
    const f = fileOf(to), r = rankOf(to);
    return c === 1 ? r >= this.colMax[f] : r <= this.colMin[f];
  }

  private pushPawnMove(out: number[], from: number, to: number, c: Side) {
    if (this.isPromotionSquare(to, c)) {
      out.push(encode(from, to, QUEEN), encode(from, to, ROOK), encode(from, to, BISHOP), encode(from, to, KNIGHT));
    } else {
      out.push(encode(from, to));
    }
  }

  /** Pseudo-legal piece moves for the side to move (expansions are separate). */
  genMoves(out: number[], capturesOnly = false): void {
    const c = this.side;
    const b = this.board;
    for (let sq = 0; sq < 256; sq++) {
      const p = b[sq] * c;
      if (p <= 0) continue;
      const f = fileOf(sq), r = rankOf(sq);

      if (p === PAWN) {
        const r1 = r + c;
        if (r1 < 0 || r1 > 15) continue;
        const one = r1 * 16 + f;
        if (this.usable(one, c) && b[one] === 0 && (!capturesOnly || this.isPromotionSquare(one, c))) {
          this.pushPawnMove(out, sq, one, c);
          const r2 = r + 2 * c;
          if (!capturesOnly && !this.moved[sq] && r2 >= 0 && r2 < 16) {
            const two = r2 * 16 + f;
            if (this.usable(two, c) && b[two] === 0) this.pushPawnMove(out, sq, two, c);
          }
        }
        for (const df of [-1, 1]) {
          if (f + df < 0 || f + df > 15) continue;
          const t = r1 * 16 + f + df;
          if (this.usable(t, c) && b[t] * c < 0) this.pushPawnMove(out, sq, t, c);
        }
      } else if (p === KNIGHT || p === KING) {
        for (const t of p === KNIGHT ? KNIGHT_TARGETS[sq] : KING_TARGETS[sq]) {
          if (!this.usable(t, c)) continue;
          const q = b[t] * c;
          if (q > 0 || (capturesOnly && q === 0)) continue;
          out.push(encode(sq, t));
        }
        if (p === KING && !capturesOnly && !this.moved[sq]) this.genCastling(out, sq, f, r, c);
      } else {
        const rays = RAYS[sq];
        const from = p === ROOK ? 0 : p === BISHOP ? 4 : 0;
        const to = p === ROOK ? 4 : 8;
        for (let d = from; d < to; d++) {
          for (const t of rays[d]) {
            if (!this.usable(t, c)) break;
            const q = b[t] * c;
            if (q > 0) break;
            if (q < 0) { out.push(encode(sq, t)); break; }
            if (!capturesOnly) out.push(encode(sq, t));
          }
        }
      }
    }
  }

  private genCastling(out: number[], sq: number, f: number, r: number, c: Side) {
    const b = this.board;
    const at = (df: number) => (f + df >= 0 && f + df < 16 ? r * 16 + f + df : -1);
    const ks = at(3);
    if (ks >= 0 && b[ks] === c * ROOK && !this.moved[ks]) {
      const path = [at(1), at(2)];
      if (path.every(t => t >= 0 && this.usable(t, c) && b[t] === 0)) out.push(encode(sq, at(2), 0, 1));
    }
    const qs = at(-4);
    if (qs >= 0 && b[qs] === c * ROOK && !this.moved[qs]) {
      const path = [at(-1), at(-2), at(-3)];
      if (path.every(t => t >= 0 && this.usable(t, c) && b[t] === 0)) out.push(encode(sq, at(-2), 0, 2));
    }
  }

  /** Castling extras (not out of check, not through an attacked square). The landing square is checked by make + inCheck. */
  castlingAllowed(m: number): boolean {
    const c = this.side;
    if (this.inCheck(c)) return false;
    const from = moveFrom(m);
    const pass = moveCastle(m) === 1 ? from + 1 : from - 1;
    return !this.isAttacked(pass, -c as Side);
  }

  /** Mirrors getLegalExpansionTargets: frontier cells, king buffer, none while in check. */
  expansionTargets(out: number[]): void {
    if (this.inCheck(this.side)) return;
    const buffer = new Set<number>();
    for (const k of [this.kingW, this.kingB]) if (k >= 0) for (const n of ORTHO_NEIGHBORS[k]) buffer.add(n);
    for (let sq = 0; sq < 256; sq++) {
      if (this.active[sq] || buffer.has(sq)) continue;
      for (const n of ORTHO_NEIGHBORS[sq]) {
        if (this.active[n]) { out.push(encodeExpansion(sq)); break; }
      }
    }
  }

  /** Plays a pseudo-legal move (or expansion) and passes the turn, like gameReducer + endTurn. */
  make(m: number): void {
    const c = this.side;
    const u: Undo = {
      move: m, captured: 0, capturedMoved: 0, fromMoved: 0,
      hashLo: this.hashLo, hashHi: this.hashHi, kingW: this.kingW, kingB: this.kingB,
      cleared: [], colMax: 0, colMin: 0,
    };

    if (isExpansion(m)) {
      const cell = moveTo(m);
      const f = fileOf(cell), r = rankOf(cell);
      u.colMax = this.colMax[f];
      u.colMin = this.colMin[f];
      this.active[cell] = 1;
      this.stab[cell] = c;
      this.stabList.push(cell);
      if (r > this.colMax[f]) this.colMax[f] = r;
      if (r < this.colMin[f]) this.colMin[f] = r;
      this.hashLo = (this.hashLo ^ Z_ACTIVE_LO[cell] ^ Z_STAB_LO[stabKey(c, cell)]) >>> 0;
      this.hashHi = (this.hashHi ^ Z_ACTIVE_HI[cell] ^ Z_STAB_HI[stabKey(c, cell)]) >>> 0;
    } else {
      const from = moveFrom(m), to = moveTo(m);
      const piece = this.board[from];
      const captured = this.board[to];
      u.captured = captured;
      u.capturedMoved = this.moved[to];
      u.fromMoved = this.moved[from];

      this.togglePiece(piece, this.moved[from], from);
      if (captured) this.togglePiece(captured, this.moved[to], to);
      const promo = movePromo(m);
      const placed = promo ? promo * c : piece;
      this.board[to] = placed;
      this.board[from] = 0;
      this.moved[to] = 1;
      this.moved[from] = 0;
      this.togglePiece(placed, 1, to);

      if (piece === KING) this.kingW = to;
      else if (piece === -KING) this.kingB = to;

      const castle = moveCastle(m);
      if (castle) {
        const rookFrom = castle === 1 ? to + 1 : to - 2;
        const rookTo = castle === 1 ? to - 1 : to + 1;
        const rook = this.board[rookFrom];
        this.togglePiece(rook, this.moved[rookFrom], rookFrom);
        this.board[rookTo] = rook;
        this.board[rookFrom] = 0;
        this.moved[rookTo] = 1;
        this.moved[rookFrom] = 0;
        this.togglePiece(rook, 1, rookTo);
      }
    }

    // Turn passes: the next player's own stabilizing cells become normal cells
    const next = -c as Side;
    if (this.stabList.length) {
      const keep: number[] = [];
      for (const cell of this.stabList) {
        if (this.stab[cell] === next) {
          this.stab[cell] = 0;
          u.cleared.push(cell);
          this.hashLo = (this.hashLo ^ Z_STAB_LO[stabKey(next, cell)]) >>> 0;
          this.hashHi = (this.hashHi ^ Z_STAB_HI[stabKey(next, cell)]) >>> 0;
        } else {
          keep.push(cell);
        }
      }
      this.stabList = keep;
    }
    this.side = next;
    this.hashLo = (this.hashLo ^ Z_SIDE_LO) >>> 0;
    this.hashHi = (this.hashHi ^ Z_SIDE_HI) >>> 0;
    this.undos.push(u);
  }

  unmake(): void {
    const u = this.undos.pop()!;
    const m = u.move;
    this.side = -this.side as Side;
    const c = this.side;

    for (const cell of u.cleared) {
      this.stab[cell] = -c;
      this.stabList.push(cell);
    }

    if (isExpansion(m)) {
      const cell = moveTo(m);
      const f = fileOf(cell);
      this.active[cell] = 0;
      this.stab[cell] = 0;
      this.stabList = this.stabList.filter(s => s !== cell);
      this.colMax[f] = u.colMax;
      this.colMin[f] = u.colMin;
    } else {
      const from = moveFrom(m), to = moveTo(m);
      const castle = moveCastle(m);
      if (castle) {
        const rookFrom = castle === 1 ? to + 1 : to - 2;
        const rookTo = castle === 1 ? to - 1 : to + 1;
        this.board[rookFrom] = this.board[rookTo];
        this.board[rookTo] = 0;
        this.moved[rookFrom] = 0;
        this.moved[rookTo] = 0;
      }
      const placed = this.board[to];
      this.board[from] = movePromo(m) ? PAWN * c : placed;
      this.moved[from] = u.fromMoved;
      this.board[to] = u.captured;
      this.moved[to] = u.capturedMoved;
    }

    this.kingW = u.kingW;
    this.kingB = u.kingB;
    this.hashLo = u.hashLo;
    this.hashHi = u.hashHi;
  }

  /** All legal actions (piece moves first, then expansions) for the side to move. */
  legalActions(): number[] {
    const pseudo: number[] = [];
    this.genMoves(pseudo);
    const legal: number[] = [];
    const c = this.side;
    for (const m of pseudo) {
      if (moveCastle(m) && !this.castlingAllowed(m)) continue;
      this.make(m);
      if (!this.inCheck(c)) legal.push(m);
      this.unmake();
    }
    this.expansionTargets(legal);
    return legal;
  }
}

/** Converts an engine move back into a rules-engine action for the given game. */
export function toTurnAction(state: GameState, m: number): TurnAction {
  const to = moveTo(m);
  const toId = getCellId(to & 15, to >> 4);
  if (isExpansion(m)) return { type: 'EXPAND', cellId: toId };
  const from = moveFrom(m);
  const piece = getPieceAt(state, getCellId(from & 15, from >> 4));
  if (!piece) throw new Error('No piece on the move origin');
  const action: TurnAction = { type: 'MOVE', pieceId: piece.id, toCellId: toId };
  const promo = movePromo(m);
  if (promo) action.promotionTo = CODE_TO_TYPE[promo];
  const castle = moveCastle(m);
  if (castle) action.isCastling = castle === 1 ? 'KINGSIDE' : 'QUEENSIDE';
  return action;
}

export function sideOf(color: PlayerColor): Side {
  return color === 'WHITE' ? 1 : -1;
}
