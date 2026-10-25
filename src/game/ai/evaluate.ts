import { BISHOP, KING, KING_TARGETS, KNIGHT, KNIGHT_TARGETS, PAWN, Position, QUEEN, RAYS, ROOK, Side } from './position';

/**
 * Static evaluation in centipawns from the point of view of the side to move.
 *
 * Terms (kept cheap, because this runs at every leaf of the search):
 * - material
 * - mobility / board control: cells each piece can reach on the *current* board, so lines
 *   opened by expansions are valued automatically
 * - pawn progress towards the promotion line of its own column (which expansions can push back)
 * - centralisation relative to the centre of the current active board, not the 16x16 grid
 * - king safety: friendly shield around the king and enemy pieces close to it
 */

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];
const MOBILITY_WEIGHT = [0, 0, 4, 4, 2, 1, 0];
const PAWN_PROGRESS = [0, 90, 50, 25, 12, 5]; // by distance to the promotion line
const TEMPO = 10;

export function evaluate(pos: Position): number {
  const b = pos.board;

  // Centre of the active board (it moves as the board grows)
  let cf = 0, cr = 0, n = 0;
  for (let sq = 0; sq < 256; sq++) {
    if (pos.active[sq]) { cf += sq & 15; cr += sq >> 4; n++; }
  }
  cf /= n || 1;
  cr /= n || 1;

  let score = 0;
  for (let sq = 0; sq < 256; sq++) {
    const p = b[sq];
    if (p === 0) continue;
    const c: Side = p > 0 ? 1 : -1;
    const type = p * c;
    const f = sq & 15, r = sq >> 4;
    let s = PIECE_VALUE[type];

    if (type === PAWN) {
      const line = c === 1 ? pos.colMax[f] : pos.colMin[f];
      const dist = Math.abs(line - r);
      if (dist < PAWN_PROGRESS.length) s += PAWN_PROGRESS[dist];
    } else if (type === KNIGHT) {
      let mob = 0;
      for (const t of KNIGHT_TARGETS[sq]) if (pos.usable(t, c) && b[t] * c <= 0) mob++;
      s += mob * MOBILITY_WEIGHT[KNIGHT];
      s -= Math.round((Math.abs(f - cf) + Math.abs(r - cr)) * 4);
    } else if (type === BISHOP || type === ROOK || type === QUEEN) {
      const d0 = type === BISHOP ? 4 : 0;
      const d1 = type === ROOK ? 4 : 8;
      let mob = 0;
      for (let d = d0; d < d1; d++) {
        for (const t of RAYS[sq][d]) {
          if (!pos.usable(t, c)) break;
          const q = b[t] * c;
          if (q > 0) break;
          mob++;
          if (q < 0) break;
        }
      }
      s += mob * MOBILITY_WEIGHT[type];
      if (type !== ROOK) s -= Math.round((Math.abs(f - cf) + Math.abs(r - cr)) * 2);
    } else if (type === KING) {
      let shield = 0, escape = 0;
      for (const t of KING_TARGETS[sq]) {
        const q = b[t] * c;
        if (q > 0) shield++;
        else if (q === 0 && pos.usable(t, c)) escape++;
      }
      s += Math.min(shield, 3) * 12;
      if (escape === 0) s -= 30;
    }
    score += c * s;
  }

  // Enemy pieces near each king
  for (const [k, c] of [[pos.kingW, 1], [pos.kingB, -1]] as [number, Side][]) {
    if (k < 0) continue;
    const kf = k & 15, kr = k >> 4;
    let danger = 0;
    for (let df = -2; df <= 2; df++) {
      for (let dr = -2; dr <= 2; dr++) {
        const f = kf + df, r = kr + dr;
        if (f < 0 || f > 15 || r < 0 || r > 15) continue;
        const q = b[r * 16 + f] * c;
        if (q < 0 && -q !== PAWN && -q !== KING) danger += -q === QUEEN ? 3 : 1;
      }
    }
    score -= c * danger * 9;
  }

  return pos.side * score + TEMPO;
}
