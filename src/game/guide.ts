import { GameState, PieceType, PlayerColor, TurnAction } from './types';
import { BOARD_START, createInitialGameState, getCellId } from './utils';

/**
 * How-to-Play guide: each step has a small interactive position and an optional goal.
 * The positions are ordinary GameStates, so the real rules engine runs the demos.
 */

export interface GuideStep {
  id: string;
  title: string;
  body: string[];
  /** What the reader is asked to do on the mini board (null = just read). */
  task: string | null;
  success?: string;
  scenario: () => GameState;
  goal?: (before: GameState, action: TurnAction, after: GameState) => boolean;
}

/** Classical square on the starting board ('e2') -> grid cell id. */
const sq = (name: string) => getCellId(name.charCodeAt(0) - 97 + BOARD_START, Number(name.slice(1)) - 1 + BOARD_START);

function emptyBoard(): GameState {
  const state = createInitialGameState();
  state.pieces = {};
  return state;
}

let counter = 0;
function put(state: GameState, type: PieceType, owner: PlayerColor, cellId: string, hasMoved = true) {
  const id = `guide_${owner[0]}_${type}_${counter++}`;
  state.pieces[id] = { id, owner, type, cellId, hasMoved };
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Chess, on a board that grows',
    body: [
      'You play with the normal chess army and the normal chess moves. You win by checkmate, exactly as in chess.',
      'The difference: the game takes place on a 16×16 grid, and only the middle 8×8 is in play at the start. The dark cells around it are empty space that can become part of the board.',
    ],
    task: null,
    scenario: createInitialGameState,
  },
  {
    id: 'move',
    title: 'Each turn: move…',
    body: [
      'On your turn you do exactly one thing. The first option is a normal chess move: click one of your pieces, then one of its dots.',
    ],
    task: 'Make any move with White.',
    success: 'That is a normal chess move.',
    scenario: createInitialGameState,
    goal: (_b, action) => action.type === 'MOVE',
  },
  {
    id: 'expand',
    title: '…or grow the board',
    body: [
      'The other option is to expand: add one cell to the edge of the board. The faint cyan squares show where you can expand.',
      'A new cell must share a side with the board (touching only at a corner does not count), so the board always stays one piece.',
    ],
    task: 'Click one of the faint cyan cells to add it.',
    success: 'The board grew by one cell, and that used up your turn.',
    scenario: createInitialGameState,
    goal: (_b, action) => action.type === 'EXPAND',
  },
  {
    id: 'stabilizing',
    title: 'New cells need a turn to settle',
    body: [
      'A freshly added cell is orange. The player who did not add it cannot move onto it or through it until the next turn of the player who added it.',
      'Here Black has just added the orange cell next to your rook.',
    ],
    task: 'Try to move the rook onto the orange cell (you can\'t), then make any other move.',
    success: 'Right: the orange cell is off-limits for one turn.',
    scenario: () => {
      const s = emptyBoard();
      put(s, 'KING', 'WHITE', sq('e1'));
      put(s, 'KING', 'BLACK', sq('e8'));
      put(s, 'ROOK', 'WHITE', sq('a4'));
      const cell = getCellId(BOARD_START - 1, BOARD_START + 3);
      s.board[cell].active = true;
      s.board[cell].stabilizingUntil = 'BLACK';
      s.lastExpansion = cell;
      return s;
    },
    goal: (_b, action) => action.type === 'MOVE',
  },
  {
    id: 'king-rules',
    title: 'Kings: no expanding next to them, none in check',
    body: [
      'You may never add a cell that touches either king\'s side (the king buffer), so a king can\'t be boxed in by geometry alone.',
      'While you are in check you cannot expand at all: you must answer the check with a move. Notice that no cyan cells are shown.',
    ],
    task: 'Your king is in check from the rook. Get out of check.',
    success: 'Check answered with a move: that is the only way.',
    scenario: () => {
      const s = emptyBoard();
      put(s, 'KING', 'WHITE', sq('e1'));
      put(s, 'ROOK', 'WHITE', sq('a2'));
      put(s, 'ROOK', 'BLACK', sq('e8'));
      put(s, 'KING', 'BLACK', sq('a8'));
      return s;
    },
    goal: (_b, action) => action.type === 'MOVE',
  },
  {
    id: 'holes',
    title: 'Empty space is a hole',
    body: [
      'Inactive cells do not exist for play. Rooks, bishops and queens stop at them, and pawns cannot step onto them.',
      'Knights jump, so they can hop over empty space, but they must land on an active cell.',
    ],
    task: 'Jump the knight across the gap onto the lone cell on the left.',
    success: 'Knights are the only pieces that can cross a gap.',
    scenario: () => {
      const s = emptyBoard();
      put(s, 'KING', 'WHITE', sq('e1'));
      put(s, 'KING', 'BLACK', sq('e8'));
      put(s, 'KNIGHT', 'WHITE', sq('a4'));
      s.board[getCellId(BOARD_START - 2, BOARD_START + 4)].active = true; // an island two files left of a5
      return s;
    },
    goal: (_b, action) => action.type === 'MOVE' && action.toCellId === getCellId(BOARD_START - 2, BOARD_START + 4),
  },
  {
    id: 'promotion',
    title: 'The promotion line moves with the board',
    body: [
      'A pawn promotes on the farthest active cell of its column. If someone adds a cell beyond the end of a column, that column\'s promotion line moves back by one.',
      'This column is one cell longer than the others, so the pawn must go one step further than usual.',
    ],
    task: 'Promote the pawn: push it to the very end of its column.',
    success: 'Promoted to a queen.',
    scenario: () => {
      const s = emptyBoard();
      put(s, 'KING', 'WHITE', sq('h1'));
      put(s, 'KING', 'BLACK', sq('h8'));
      put(s, 'PAWN', 'WHITE', sq('a8'));
      s.board[getCellId(BOARD_START, BOARD_START + 8)].active = true; // a9: the a-file is longer
      return s;
    },
    goal: (_b, action) => action.type === 'MOVE' && Boolean(action.promotionTo),
  },
  {
    id: 'ready',
    title: 'You\'re ready',
    body: [
      'Each player has a clock: 30 minutes for the whole game. It starts once both players are ready.',
      'You can offer a draw or resign (Abandon Protocol) from the sidebar. The move list on the right uses grid labels a–p and 1–16, and Exp d8 means "expanded cell d8". Click any move to replay it.',
      'You can reopen this guide at any time with the How to play button.',
    ],
    task: null,
    scenario: createInitialGameState,
  },
];
