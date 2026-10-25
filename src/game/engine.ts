import { GameState, MoveAction, PlayerColor, Piece, PieceType } from './types';
import { getCellId, getPieceAt, isCellUsableBy, isOutOfBounds, opponentOf, parseCellId, GRID_SIZE } from './utils';

const ORTHOGONAL = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const DIAGONAL = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

const DIRS = {
  ROOK: ORTHOGONAL,
  BISHOP: DIAGONAL,
  QUEEN: [...ORTHOGONAL, ...DIAGONAL],
  KNIGHT: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  KING: [...ORTHOGONAL, ...DIAGONAL]
};

const PROMOTION_CHOICES: PieceType[] = ['QUEEN', 'ROOK', 'BISHOP', 'KNIGHT'];

/**
 * Generates pseudo-legal moves (ignoring check protection)
 */
export function getPseudoLegalMoves(game: GameState, pieceId: string): MoveAction[] {
  const piece = game.pieces[pieceId];
  if (!piece) return [];

  const moves: MoveAction[] = [];
  const [file, rank] = parseCellId(piece.cellId);
  const color = piece.owner;
  const canEnter = (f: number, r: number) => !isOutOfBounds(f, r) && isCellUsableBy(game, getCellId(f, r), color);

  if (piece.type === 'KNIGHT' || piece.type === 'KING') {
    // Knights jump, so inactive cells in between do not matter - only the landing cell does.
    for (const [df, dr] of DIRS[piece.type]) {
      const f = file + df;
      const r = rank + dr;
      if (!canEnter(f, r)) continue;
      const targetId = getCellId(f, r);
      const targetPiece = getPieceAt(game, targetId);
      if (!targetPiece || targetPiece.owner !== color) {
        moves.push({ type: 'MOVE', pieceId, toCellId: targetId });
      }
    }

    if (piece.type === 'KING') moves.push(...getCastlingMoves(game, piece));
  } else if (piece.type === 'ROOK' || piece.type === 'BISHOP' || piece.type === 'QUEEN') {
    for (const [df, dr] of DIRS[piece.type]) {
      let f = file + df;
      let r = rank + dr;
      // Inactive (or still-stabilizing) cells are holes in the board: sliders stop at them.
      while (canEnter(f, r)) {
        const targetId = getCellId(f, r);
        const targetPiece = getPieceAt(game, targetId);
        if (targetPiece) {
          if (targetPiece.owner !== color) {
            moves.push({ type: 'MOVE', pieceId, toCellId: targetId });
          }
          break; // Blocked
        }
        moves.push({ type: 'MOVE', pieceId, toCellId: targetId });
        f += df;
        r += dr;
      }
    }
  } else if (piece.type === 'PAWN') {
    const dir = color === 'WHITE' ? 1 : -1;

    // Step 1
    if (canEnter(file, rank + dir) && !getPieceAt(game, getCellId(file, rank + dir))) {
      moves.push({ type: 'MOVE', pieceId, toCellId: getCellId(file, rank + dir) });
      // Step 2
      if (!piece.hasMoved && canEnter(file, rank + 2 * dir) && !getPieceAt(game, getCellId(file, rank + 2 * dir))) {
        moves.push({ type: 'MOVE', pieceId, toCellId: getCellId(file, rank + 2 * dir) });
      }
    }

    // Captures
    for (const df of [-1, 1]) {
      if (!canEnter(file + df, rank + dir)) continue;
      const targetPiece = getPieceAt(game, getCellId(file + df, rank + dir));
      if (targetPiece && targetPiece.owner !== color) {
        moves.push({ type: 'MOVE', pieceId, toCellId: getCellId(file + df, rank + dir) });
      }
    }
  }

  return attachPromotions(game, piece, moves);
}

/**
 * Castling uses the original back-rank layout: an unmoved king with an unmoved
 * rook three files to the right (kingside) or four files to the left (queenside).
 */
function getCastlingMoves(game: GameState, king: Piece): MoveAction[] {
  if (king.hasMoved) return [];
  const [file, rank] = parseCellId(king.cellId);
  const moves: MoveAction[] = [];

  const sides: { side: 'KINGSIDE' | 'QUEENSIDE', rookOffset: number, path: number[], kingTo: number }[] = [
    { side: 'KINGSIDE', rookOffset: 3, path: [1, 2], kingTo: 2 },
    { side: 'QUEENSIDE', rookOffset: -4, path: [-1, -2, -3], kingTo: -2 },
  ];

  for (const { side, rookOffset, path, kingTo } of sides) {
    const rook = getPieceAt(game, getCellId(file + rookOffset, rank));
    if (!rook || rook.type !== 'ROOK' || rook.owner !== king.owner || rook.hasMoved) continue;
    const pathClear = path.every(offset => {
      const id = getCellId(file + offset, rank);
      return isCellUsableBy(game, id, king.owner) && !getPieceAt(game, id);
    });
    if (pathClear) {
      moves.push({ type: 'MOVE', pieceId: king.id, toCellId: getCellId(file + kingTo, rank), isCastling: side });
    }
  }
  return moves;
}

function attachPromotions(game: GameState, piece: Piece, moves: MoveAction[]): MoveAction[] {
  if (piece.type !== 'PAWN') return moves;

  const finalMoves: MoveAction[] = [];
  for (const m of moves) {
    if (isPromotionSquare(game, piece.owner, m.toCellId)) {
      for (const promotionTo of PROMOTION_CHOICES) finalMoves.push({ ...m, promotionTo });
    } else {
      finalMoves.push(m);
    }
  }
  return finalMoves;
}

/**
 * The promotion line is the farthest active cell (from the owner's side) in a given file.
 * Expanding a column therefore pushes that column's promotion line further away.
 */
export function getFarthestRankInColumn(game: GameState, file: number, color: PlayerColor): number {
  if (color === 'WHITE') {
    for (let r = GRID_SIZE - 1; r >= 0; r--) {
      if (game.board[getCellId(file, r)]?.active) return r;
    }
    return GRID_SIZE - 1;
  }
  for (let r = 0; r < GRID_SIZE; r++) {
    if (game.board[getCellId(file, r)]?.active) return r;
  }
  return 0;
}

/** Promotion is decided by the column the pawn lands in (which differs from its own column on a capture). */
function isPromotionSquare(game: GameState, color: PlayerColor, toCellId: string): boolean {
  const [file, rank] = parseCellId(toCellId);
  const farthestRank = getFarthestRankInColumn(game, file, color);
  return color === 'WHITE' ? rank >= farthestRank : rank <= farthestRank;
}

export function isPromotionMove(game: GameState, pieceId: string, toCellId: string): boolean {
  const piece = game.pieces[pieceId];
  if (!piece || piece.type !== 'PAWN') return false;
  return isPromotionSquare(game, piece.owner, toCellId);
}

/**
 * Whether `piece` attacks the given square right now, regardless of what stands on it.
 * Pawns attack diagonally only; sliders need every cell in between to be usable and empty.
 */
function pieceAttacksSquare(game: GameState, piece: Piece, tf: number, tr: number): boolean {
  const [f, r] = parseCellId(piece.cellId);
  const df = tf - f;
  const dr = tr - r;
  if (df === 0 && dr === 0) return false;
  const color = piece.owner;
  if (isOutOfBounds(tf, tr) || !isCellUsableBy(game, getCellId(tf, tr), color)) return false;

  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  switch (piece.type) {
    case 'PAWN':
      return dr === (color === 'WHITE' ? 1 : -1) && adf === 1;
    case 'KNIGHT':
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case 'KING':
      return Math.max(adf, adr) === 1;
    default: {
      const straight = df === 0 || dr === 0;
      const diagonal = adf === adr;
      if (piece.type === 'ROOK' && !straight) return false;
      if (piece.type === 'BISHOP' && !diagonal) return false;
      if (!straight && !diagonal) return false;

      const sf = Math.sign(df);
      const sr = Math.sign(dr);
      let cf = f + sf;
      let cr = r + sr;
      while (cf !== tf || cr !== tr) {
        const id = getCellId(cf, cr);
        if (!isCellUsableBy(game, id, color) || getPieceAt(game, id)) return false;
        cf += sf;
        cr += sr;
      }
      return true;
    }
  }
}

export function isSquareAttacked(game: GameState, cellId: string, byColor: PlayerColor): boolean {
  const [tf, tr] = parseCellId(cellId);
  return Object.values(game.pieces).some(p => p.owner === byColor && pieceAttacksSquare(game, p, tf, tr));
}

export function isInCheck(game: GameState, color: PlayerColor): boolean {
  const king = Object.values(game.pieces).find(p => p.type === 'KING' && p.owner === color);
  if (!king) return false;
  return isSquareAttacked(game, king.cellId, opponentOf(color));
}

/**
 * Filter moves that leave king in check
 */
export function getLegalMoves(game: GameState, pieceId: string): MoveAction[] {
  const piece = game.pieces[pieceId];
  if (!piece || piece.owner !== game.currentPlayer || game.status !== 'ONGOING') return [];

  const opponent = opponentOf(piece.owner);
  const pseudo = getPseudoLegalMoves(game, pieceId);
  return pseudo.filter(m => {
    // Castling: not out of check, not through an attacked square (landing square is checked below)
    if (m.isCastling) {
      if (isInCheck(game, piece.owner)) return false;
      const [file, rank] = parseCellId(piece.cellId);
      const passId = getCellId(m.isCastling === 'KINGSIDE' ? file + 1 : file - 1, rank);
      if (isSquareAttacked(game, passId, opponent)) return false;
    }

    const next = structuredClone(game);
    applyMove(next, m);
    return !isInCheck(next, piece.owner);
  });
}

export function hasAnyLegalMove(game: GameState, color: PlayerColor): boolean {
  return Object.values(game.pieces).some(p => p.owner === color && getLegalMoves(game, p.id).length > 0);
}

/**
 * Cells the current player may activate this turn:
 * - inactive and orthogonally adjacent to an active cell (the board only grows at its edge,
 *   so it always stays one connected region)
 * - not orthogonally adjacent to either king (king buffer)
 * - none at all while the current player is in check (an expansion can never answer a check)
 */
export function getLegalExpansionTargets(game: GameState): string[] {
  if (game.status !== 'ONGOING') return [];
  if (isInCheck(game, game.currentPlayer)) return [];

  const kingBuffer = new Set<string>();
  for (const king of Object.values(game.pieces)) {
    if (king.type !== 'KING') continue;
    const [kf, kr] = parseCellId(king.cellId);
    for (const [df, dr] of ORTHOGONAL) kingBuffer.add(getCellId(kf + df, kr + dr));
  }

  const targets: string[] = [];
  for (let f = 0; f < GRID_SIZE; f++) {
    for (let r = 0; r < GRID_SIZE; r++) {
      const id = getCellId(f, r);
      if (game.board[id].active || kingBuffer.has(id)) continue;

      const isAdjacent = ORTHOGONAL.some(([df, dr]) =>
        !isOutOfBounds(f + df, r + dr) && game.board[getCellId(f + df, r + dr)].active
      );
      if (isAdjacent) targets.push(id);
    }
  }
  return targets;
}

/**
 * Applies a (pre-validated) move to `game` in place: capture, promotion and the castling rook.
 * Returns the captured piece, if any.
 */
export function applyMove(game: GameState, move: MoveAction): Piece | undefined {
  const piece = game.pieces[move.pieceId];

  const captured = getPieceAt(game, move.toCellId);
  if (captured) delete game.pieces[captured.id];

  piece.cellId = move.toCellId;
  piece.hasMoved = true;
  if (move.promotionTo) piece.type = move.promotionTo;

  if (move.isCastling) {
    const [f, r] = parseCellId(move.toCellId);
    const rookFrom = move.isCastling === 'KINGSIDE' ? getCellId(f + 1, r) : getCellId(f - 2, r);
    const rookTo = move.isCastling === 'KINGSIDE' ? getCellId(f - 1, r) : getCellId(f + 1, r);
    const rook = getPieceAt(game, rookFrom);
    if (rook) {
      rook.cellId = rookTo;
      rook.hasMoved = true;
    }
  }

  return captured;
}
