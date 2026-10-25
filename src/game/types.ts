export type PlayerColor = 'WHITE' | 'BLACK';

export type PieceType = 'KING' | 'QUEEN' | 'ROOK' | 'BISHOP' | 'KNIGHT' | 'PAWN';

export interface CellCoord {
  file: number; // 0..15 (x)
  rank: number; // 0..15 (y)
}

export interface Cell {
  id: string;        // "file,rank"
  file: number;
  rank: number;
  active: boolean;   // is this cell part of the playable board
  stabilizingUntil: PlayerColor | null; // set to the expanding player; cleared when their next turn starts
}

export interface Piece {
  id: string;
  owner: PlayerColor;
  type: PieceType;
  cellId: string;
  hasMoved: boolean;
}

export type GameStatus = 'ONGOING' | 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';

export type EndReason = 'CHECKMATE' | 'STALEMATE' | 'RESIGNATION' | 'TIMEOUT' | 'AGREEMENT';

/**
 * Pure Game State (Authoritative)
 */
export interface GameState {
  gameId: string; // changes on every new game so clients can detect a reset
  board: Record<string, Cell>;
  pieces: Record<string, Piece>;
  currentPlayer: PlayerColor;
  status: GameStatus;
  endReason: EndReason | null;

  names: Record<PlayerColor, string>; // Player identifiers

  lastMove: { from: string, to: string, pieceType: PieceType } | null;
  lastExpansion: string | null;
  history: BoardAction[]; // only turn-taking actions (moves and expansions)
  notation: string[];     // notation[i] describes history[i]
  halfMoveClock: number;  // half-moves since the last capture or pawn move
  version: number;
  ready: Record<PlayerColor, boolean>; // each player has clicked "I'm ready" (online: the clock waits for both)
  drawOffer: PlayerColor | null;  // who has a draw offer pending
  drawOfferPly: Record<PlayerColor, number | null>; // history length when each side last offered
  clocks: Record<PlayerColor, number>; // Time in seconds
  lastTick: number | null; // Timestamp of last clock sync
}

export type UIMode = 'MOVE' | 'EXPAND_SELECT' | 'GAME_OVER';

export interface ViewState {
  uiMode: UIMode;
  selectedPieceId: string | null;
  legalMoves: string[];
  legalExpansionTargets: string[];
}

export interface CompleteState {
  game: GameState;
  view: ViewState;
}

export interface MoveAction {
  type: 'MOVE';
  pieceId: string;
  toCellId: string;
  promotionTo?: PieceType;
  isCastling?: 'KINGSIDE' | 'QUEENSIDE';
}

export interface ExpandAction {
  type: 'EXPAND';
  cellId: string;
}

export interface SetNameAction {
  type: 'SET_NAME';
  player: PlayerColor;
  name: string;
}

export interface ResignAction {
  type: 'RESIGN';
  player: PlayerColor;
}

export interface ReadyAction {
  type: 'READY';
  player: PlayerColor;
}

export interface OfferDrawAction {
  type: 'OFFER_DRAW';
  player: PlayerColor;
}

export interface RespondDrawAction {
  type: 'RESPOND_DRAW';
  player: PlayerColor;
  accept: boolean;
}

/** Actions that consume a turn and appear in the move list */
export type BoardAction = MoveAction | ExpandAction;

export type TurnAction =
  | MoveAction
  | ExpandAction
  | SetNameAction
  | ResignAction
  | ReadyAction
  | OfferDrawAction
  | RespondDrawAction;
