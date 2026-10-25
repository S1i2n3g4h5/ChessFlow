import { GameState, PieceType, Piece, Cell, CompleteState, ViewState, UIMode, PlayerColor } from './types';

export const GRID_SIZE = 16;
export const BOARD_START = 4;
export const BOARD_END = 11; // Inclusive (4,5,6,7,8,9,10,11 = 8x8)
export const INITIAL_CLOCK_SECONDS = 1800;

export function getCellId(file: number, rank: number): string {
  return `${file},${rank}`;
}

export function parseCellId(cellId: string): [number, number] {
  const [file, rank] = cellId.split(',').map(Number);
  return [file, rank];
}

export function opponentOf(color: PlayerColor): PlayerColor {
  return color === 'WHITE' ? 'BLACK' : 'WHITE';
}

const STARTING_PIECES: { [key: string]: PieceType } = {
  '0': 'ROOK',
  '1': 'KNIGHT',
  '2': 'BISHOP',
  '3': 'QUEEN',
  '4': 'KING',
  '5': 'BISHOP',
  '6': 'KNIGHT',
  '7': 'ROOK'
};

function createGameId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createInitialGameState(): GameState {
  const board: Record<string, Cell> = {};
  const pieces: Record<string, Piece> = {};

  // Initialize board
  for (let file = 0; file < GRID_SIZE; file++) {
    for (let rank = 0; rank < GRID_SIZE; rank++) {
      const isCentral = file >= BOARD_START && file <= BOARD_END && rank >= BOARD_START && rank <= BOARD_END;
      const cellId = getCellId(file, rank);
      board[cellId] = {
        id: cellId,
        file,
        rank,
        active: isCentral,
        stabilizingUntil: null,
      };

      if (isCentral) {
        const localFile = file - BOARD_START;

        // White
        if (rank === BOARD_START) {
          const id = `w_${STARTING_PIECES[localFile]}_${localFile}`;
          pieces[id] = {
            id,
            owner: 'WHITE',
            type: STARTING_PIECES[localFile],
            cellId: cellId,
            hasMoved: false,
          };
        }
        if (rank === BOARD_START + 1) {
          const id = `w_PAWN_${localFile}`;
          pieces[id] = {
            id,
            owner: 'WHITE',
            type: 'PAWN',
            cellId: cellId,
            hasMoved: false,
          };
        }

        // Black
        if (rank === BOARD_END - 1) {
          const id = `b_PAWN_${localFile}`;
          pieces[id] = {
            id,
            owner: 'BLACK',
            type: 'PAWN',
            cellId: cellId,
            hasMoved: false,
          };
        }
        if (rank === BOARD_END) {
          const id = `b_${STARTING_PIECES[localFile]}_${localFile}`;
          pieces[id] = {
            id,
            owner: 'BLACK',
            type: STARTING_PIECES[localFile],
            cellId: cellId,
            hasMoved: false,
          };
        }
      }
    }
  }

  return {
    gameId: createGameId(),
    board,
    pieces,
    currentPlayer: 'WHITE',
    status: 'ONGOING',
    endReason: null,
    names: { WHITE: '', BLACK: '' },
    lastMove: null,
    lastExpansion: null,
    history: [],
    notation: [],
    halfMoveClock: 0,
    version: 0,
    ready: { WHITE: false, BLACK: false },
    drawOffer: null,
    drawOfferPly: { WHITE: null, BLACK: null },
    clocks: { WHITE: INITIAL_CLOCK_SECONDS, BLACK: INITIAL_CLOCK_SECONDS },
    lastTick: null,
  };
}

import { getLegalMoves, getLegalExpansionTargets } from './engine';

/**
 * Derives the ViewState (UI Context) from the Authoritative GameState
 */
export function deriveCompleteState(game: GameState, selectedPieceId: string | null): CompleteState {
  let uiMode: UIMode = 'MOVE';
  if (game.status !== 'ONGOING') {
    uiMode = 'GAME_OVER';
  }

  // Each turn is either a move or an expansion, so both are always offered.
  const legalMoves = selectedPieceId
    ? getLegalMoves(game, selectedPieceId).map(m => m.toCellId)
    : [];

  const legalExpansionTargets = getLegalExpansionTargets(game);

  const view: ViewState = {
    uiMode,
    selectedPieceId,
    legalMoves,
    legalExpansionTargets
  };

  return { game, view };
}

export function getPieceAt(state: GameState, cellId: string): Piece | undefined {
  return Object.values(state.pieces).find((p) => p.cellId === cellId);
}

export function isCellActive(state: GameState, cellId: string): boolean {
  return state.board[cellId]?.active === true;
}

export function isCellStabilizing(state: GameState, cellId: string): boolean {
  return state.board[cellId]?.stabilizingUntil !== null;
}

/**
 * A freshly expanded cell is off-limits to the opponent of the player who placed it.
 * It is cleared at the start of the placer's next turn, so the placer's own pieces
 * can always treat it as a normal square (including for attacks / check detection).
 */
export function isCellUsableBy(state: GameState, cellId: string, color: PlayerColor): boolean {
  const cell = state.board[cellId];
  if (!cell || !cell.active) return false;
  return cell.stabilizingUntil === null || cell.stabilizingUntil === color;
}

export function isOutOfBounds(file: number, rank: number) {
  return file < 0 || file >= GRID_SIZE || rank < 0 || rank >= GRID_SIZE;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * SVG viewBox for the board. Unlocked: the whole 16x16 grid.
 * Locked: a square that frames every active cell plus `padding` cells,
 * computed in screen space so it also works when the board is flipped for Black.
 */
export function computeViewBox(game: GameState, isFlipped: boolean, locked: boolean, padding = 2): ViewBox {
  const full = { x: 0, y: 0, width: GRID_SIZE, height: GRID_SIZE };
  if (!locked) return full;

  let minX = GRID_SIZE, maxX = -1, minY = GRID_SIZE, maxY = -1;
  for (const cell of Object.values(game.board)) {
    if (!cell.active) continue;
    const x = isFlipped ? GRID_SIZE - 1 - cell.file : cell.file;
    const y = isFlipped ? cell.rank : GRID_SIZE - 1 - cell.rank;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return full;

  const size = Math.min(GRID_SIZE, Math.max(maxX - minX, maxY - minY) + 1 + padding * 2);
  const start = (min: number, max: number) =>
    Math.max(0, Math.min(GRID_SIZE - size, Math.floor((min + max + 1 - size) / 2)));

  return { x: start(minX, maxX), y: start(minY, maxY), width: size, height: size };
}
