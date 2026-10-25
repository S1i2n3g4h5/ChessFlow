import { GameState, MoveAction, Piece, PieceType } from './types';
import { getLegalMoves, isInCheck } from './engine';
import { getPieceAt, parseCellId } from './utils';

/**
 * Move-list notation on the full 16x16 grid: files a..p (left to right from White's side),
 * ranks 1..16 (bottom to top). The starting 8x8 board spans e5..l12.
 */
const FILE_LETTERS = 'abcdefghijklmnop';

const PIECE_LETTERS: Record<PieceType, string> = {
  KING: 'K',
  QUEEN: 'Q',
  ROOK: 'R',
  BISHOP: 'B',
  KNIGHT: 'N',
  PAWN: '',
};

export function fileLabel(file: number): string {
  return FILE_LETTERS[file];
}

export function rankLabel(rank: number): string {
  return String(rank + 1);
}

export function cellLabel(cellId: string): string {
  const [file, rank] = parseCellId(cellId);
  return fileLabel(file) + rankLabel(rank);
}

function checkSuffix(after: GameState): string {
  if (after.endReason === 'CHECKMATE') return '#';
  return isInCheck(after, after.currentPlayer) ? '+' : '';
}

/** Adds the origin file and/or rank when another identical piece could reach the same cell. */
function disambiguation(before: GameState, piece: Piece, toCellId: string): string {
  const rivals = Object.values(before.pieces).filter(p =>
    p.id !== piece.id &&
    p.owner === piece.owner &&
    p.type === piece.type &&
    getLegalMoves(before, p.id).some(m => m.toCellId === toCellId)
  );
  if (rivals.length === 0) return '';

  const [file, rank] = parseCellId(piece.cellId);
  const sharesFile = rivals.some(p => parseCellId(p.cellId)[0] === file);
  const sharesRank = rivals.some(p => parseCellId(p.cellId)[1] === rank);
  if (!sharesFile) return fileLabel(file);
  if (!sharesRank) return rankLabel(rank);
  return fileLabel(file) + rankLabel(rank);
}

/** `before` is the position the move was played in, `after` the position it produced. */
export function describeMove(before: GameState, move: MoveAction, after: GameState): string {
  const piece = before.pieces[move.pieceId];

  if (move.isCastling) {
    return (move.isCastling === 'KINGSIDE' ? 'O-O' : 'O-O-O') + checkSuffix(after);
  }

  const isCapture = Boolean(getPieceAt(before, move.toCellId));
  const target = cellLabel(move.toCellId);
  let text: string;

  if (piece.type === 'PAWN') {
    const fromFile = fileLabel(parseCellId(piece.cellId)[0]);
    text = (isCapture ? `${fromFile}x` : '') + target;
    if (move.promotionTo) text += `=${PIECE_LETTERS[move.promotionTo]}`;
  } else {
    text = PIECE_LETTERS[piece.type] + disambiguation(before, piece, move.toCellId) + (isCapture ? 'x' : '') + target;
  }

  return text + checkSuffix(after);
}

export function describeExpansion(cellId: string, after: GameState): string {
  return `Exp ${cellLabel(cellId)}${checkSuffix(after)}`;
}
