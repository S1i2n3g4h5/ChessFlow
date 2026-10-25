import {
  BISHOP, KING, ORTHO_NEIGHBORS, PAWN, Position, QUEEN, RAYS, ROOK,
  isExpansion, moveCastle, moveFrom, movePromo, moveTo,
} from './position';
import { PIECE_VALUE, evaluate } from './evaluate';

/**
 * Iterative-deepening negamax with alpha-beta pruning, quiescence search on captures,
 * a transposition table, killer/history move ordering and check extensions.
 *
 * Expansions multiply the branching factor (often 30+ candidates), so each node only
 * searches the K most promising ones by a cheap heuristic. When a player has no legal piece
 * move but can expand, every expansion is searched, because the rules then force one.
 */

export const MATE = 100_000;
const INF = 1_000_000;
const MAX_PLY = 64;

export interface SearchOptions {
  maxDepth: number;
  timeMs: number;
  maxNodes?: number;
  expansionsPerNode: number;   // K expansions considered at inner nodes
  rootExpansions: number;      // K expansions considered at the root
  noExpansions?: boolean;      // for experiments: a bot that never expands (unless forced)
  exactRootScores?: boolean;   // search every root move with a full window (Easy mode picks among them)
}

export interface SearchResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
  rootScores: { move: number; score: number }[]; // last completed depth, best first
}

class Stop extends Error {}

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Searcher {
  private ttKey = new Uint32Array(TT_SIZE);
  private ttDepth = new Int8Array(TT_SIZE);
  private ttFlag = new Uint8Array(TT_SIZE);
  private ttScore = new Int32Array(TT_SIZE);
  private ttMove = new Int32Array(TT_SIZE);
  private killers = Array.from({ length: MAX_PLY }, () => [0, 0]);
  private history = new Int32Array(256 * 256);
  private nodes = 0;
  private deadline = 0;
  private maxNodes = Infinity;
  private opts!: SearchOptions;

  constructor(private pos: Position) {}

  search(opts: SearchOptions): SearchResult {
    this.opts = opts;
    this.nodes = 0;
    const start = now();
    this.deadline = start + opts.timeMs;
    this.maxNodes = opts.maxNodes ?? Infinity;
    this.history.fill(0);
    for (const k of this.killers) { k[0] = 0; k[1] = 0; }

    const rootMoves = this.pos.legalActions();
    const forcedExpansion = rootMoves.every(isExpansion);
    let candidates = rootMoves;
    if (!forcedExpansion) {
      const piece = rootMoves.filter(m => !isExpansion(m));
      const expansions = rootMoves.filter(isExpansion);
      candidates = [...piece, ...(opts.noExpansions ? [] : this.bestExpansions(expansions, opts.rootExpansions))];
    }

    let best: SearchResult = { move: candidates[0] ?? 0, score: 0, depth: 0, nodes: 0, elapsedMs: 0, rootScores: [] };
    if (candidates.length <= 1) {
      best.rootScores = candidates.map(move => ({ move, score: 0 }));
      return best;
    }

    let ordered = this.orderMoves(candidates, 0, 0);
    this.depthFromRoot = 0;
    for (let depth = 1; depth <= opts.maxDepth; depth++) {
      try {
        const scores: { move: number; score: number }[] = [];
        let alpha = -INF;
        for (const m of ordered) {
          this.make(m);
          // Exact mode: full window for every move. Otherwise only "better than the best so far?"
          const score = opts.exactRootScores
            ? -this.negamax(depth - 1, -INF, INF, 1)
            : -this.negamax(depth - 1, -INF, -alpha, 1);
          this.unmake();
          scores.push({ move: m, score });
          if (score > alpha) alpha = score;
        }
        scores.sort((a, b) => b.score - a.score);
        best = { move: scores[0].move, score: scores[0].score, depth, nodes: this.nodes, elapsedMs: now() - start, rootScores: scores };
        ordered = scores.map(x => x.move);
        if (Math.abs(best.score) > MATE - 1000) break; // forced mate found
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        while (this.depthFromRoot > 0) this.unmake(); // back to the root position
        break;
      }
      if (now() - start > opts.timeMs * 0.55) break; // the next depth would not finish in time
    }
    best.nodes = this.nodes;
    best.elapsedMs = now() - start;
    return best;
  }

  /** Plies made below the root; used to unwind after a time-out (Stop). */
  private depthFromRoot = 0;

  private make(m: number) { this.pos.make(m); this.depthFromRoot++; }
  private unmake() { this.pos.unmake(); this.depthFromRoot--; }

  private tick() {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && (now() > this.deadline || this.nodes > this.maxNodes)) throw new Stop();
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.tick();
    const pos = this.pos;
    const side = pos.side;
    const inCheck = pos.inCheck(side);
    if (inCheck && ply < MAX_PLY - 8) depth++; // check extension
    if (depth <= 0 || ply >= MAX_PLY - 2) return this.quiesce(alpha, beta, ply, 0);

    // Transposition table
    const idx = pos.hashLo & (TT_SIZE - 1);
    let ttMove = 0;
    if (this.ttKey[idx] === pos.hashHi) {
      ttMove = this.ttMove[idx];
      if (this.ttDepth[idx] >= depth) {
        const s = this.ttScore[idx];
        const flag = this.ttFlag[idx];
        if (flag === TT_EXACT) return s;
        if (flag === TT_LOWER && s >= beta) return s;
        if (flag === TT_UPPER && s <= alpha) return s;
      }
    }

    const moves: number[] = [];
    pos.genMoves(moves);
    const ordered = this.orderMoves(moves, ply, ttMove);

    const alphaStart = alpha;
    let bestScore = -INF;
    let bestMove = 0;
    let legal = 0;

    for (const m of ordered) {
      if (moveCastle(m) && !pos.castlingAllowed(m)) continue;
      this.make(m);
      if (pos.inCheck(side)) { this.unmake(); continue; }
      legal++;
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.unmake();
      if (score > bestScore) { bestScore = score; bestMove = m; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (pos.board[moveTo(m)] === 0 && !movePromo(m)) this.rememberQuiet(m, ply, depth);
        break;
      }
    }

    // Expansions: never while in check; all of them if they are the only legal actions
    if (alpha < beta && !inCheck) {
      const exps: number[] = [];
      pos.expansionTargets(exps);
      if (exps.length) {
        const forced = legal === 0;
        const limit = forced ? exps.length : (this.opts.noExpansions ? 0 : this.opts.expansionsPerNode);
        for (const m of this.bestExpansions(exps, limit)) {
          this.make(m);
          legal++;
          const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
          this.unmake();
          if (score > bestScore) { bestScore = score; bestMove = m; }
          if (score > alpha) alpha = score;
          if (alpha >= beta) break;
        }
      }
    }

    if (legal === 0) return inCheck ? -MATE + ply : 0; // checkmate or stalemate

    const flag = bestScore <= alphaStart ? TT_UPPER : bestScore >= beta ? TT_LOWER : TT_EXACT;
    this.ttKey[idx] = pos.hashHi;
    this.ttDepth[idx] = depth;
    this.ttFlag[idx] = flag;
    this.ttScore[idx] = bestScore;
    this.ttMove[idx] = bestMove;
    return bestScore;
  }

  private quiesce(alpha: number, beta: number, ply: number, qdepth: number): number {
    this.tick();
    const pos = this.pos;
    const side = pos.side;
    const inCheck = pos.inCheck(side);

    if (!inCheck) {
      const stand = evaluate(pos);
      if (stand >= beta || qdepth >= 6 || ply >= MAX_PLY - 1) return stand;
      if (stand > alpha) alpha = stand;
    }

    const moves: number[] = [];
    pos.genMoves(moves, !inCheck); // in check: every evasion, otherwise captures and promotions
    const ordered = this.orderMoves(moves, ply, 0);
    let legal = 0;
    let best = inCheck ? -INF : alpha;
    for (const m of ordered) {
      if (moveCastle(m) && !pos.castlingAllowed(m)) continue;
      this.make(m);
      if (pos.inCheck(side)) { this.unmake(); continue; }
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1, qdepth + 1);
      this.unmake();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    if (inCheck && legal === 0) return -MATE + ply; // expansions are not allowed in check
    return best;
  }

  private rememberQuiet(m: number, ply: number, depth: number) {
    const k = this.killers[ply];
    if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
    const h = moveFrom(m) * 256 + moveTo(m);
    this.history[h] = Math.min(this.history[h] + depth * depth, 1 << 24);
  }

  /** TT move, then captures (most valuable victim, least valuable attacker), promotions, killers, history. */
  private orderMoves(moves: number[], ply: number, ttMove: number): number[] {
    const b = this.pos.board;
    const scored = moves.map(m => {
      let s = 0;
      if (m === ttMove) s = 10_000_000;
      else if (isExpansion(m)) s = -1;
      else {
        const victim = Math.abs(b[moveTo(m)]);
        const attacker = Math.abs(b[moveFrom(m)]);
        if (victim) s = 1_000_000 + PIECE_VALUE[victim] * 10 - PIECE_VALUE[attacker] / 10;
        else if (movePromo(m)) s = 900_000 + PIECE_VALUE[movePromo(m)];
        else if (ply < MAX_PLY && this.killers[ply][0] === m) s = 800_000;
        else if (ply < MAX_PLY && this.killers[ply][1] === m) s = 700_000;
        else s = this.history[moveFrom(m) * 256 + moveTo(m)];
      }
      return { m, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.m);
  }

  /**
   * Cheap expansion heuristic: a new cell is promising when it
   * - completes a line for one of our sliders (it lies on that slider's ray),
   * - sits beyond an enemy pawn's promotion line in its file (pushes the line back),
   * - is near our own pieces (room to manoeuvre).
   */
  private bestExpansions(exps: number[], limit: number): number[] {
    if (limit <= 0) return [];
    if (exps.length <= limit) return exps;
    const pos = this.pos;
    const b = pos.board;
    const side = pos.side;
    const scored = exps.map(m => {
      const cell = moveTo(m);
      const f = cell & 15, r = cell >> 4;
      let s = 0;
      for (let d = 0; d < 8; d++) {
        for (const t of RAYS[cell][d]) {
          if (!pos.active[t]) break;
          const p = b[t];
          if (p === 0) continue;
          const type = Math.abs(p), mine = p * side > 0;
          const slides = type === QUEEN || (d < 4 ? type === ROOK : type === BISHOP);
          if (slides) s += mine ? 30 : -10;
          break;
        }
      }
      // Pushing back an enemy pawn's promotion line
      const enemyForward = -side;
      const line = enemyForward === 1 ? pos.colMax[f] : pos.colMin[f];
      if (r === line + enemyForward) {
        for (let rr = 0; rr < 16; rr++) {
          if (b[rr * 16 + f] === enemyForward * PAWN && Math.abs(line - rr) <= 2) { s += 80; break; }
        }
      }
      for (const n of ORTHO_NEIGHBORS[cell]) {
        const p = b[n];
        if (p * side > 0 && Math.abs(p) !== KING) s += 4;
      }
      return { m, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(x => x.m);
  }
}
