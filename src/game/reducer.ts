import { GameState, TurnAction, MoveAction, ExpandAction, SetNameAction, ResignAction, ReadyAction, OfferDrawAction, RespondDrawAction } from './types';
import { applyMove, getLegalMoves, getLegalExpansionTargets, hasAnyLegalMove, isInCheck } from './engine';
import { describeExpansion, describeMove } from './notation';
import { opponentOf } from './utils';
import { canOfferDraw } from './draw';

/**
 * Applies an action and returns the next state.
 * Invalid actions return the *same* state object: no version bump, nothing logged.
 */
export function gameReducer(state: GameState, action: TurnAction): GameState {
  if (state.status !== 'ONGOING') return state;

  let result: GameState | null;

  switch (action.type) {
    case 'SET_NAME':
      result = handleSetName(state, action);
      break;
    case 'RESIGN':
      result = handleResign(state, action);
      break;
    case 'READY':
      result = handleReady(state, action);
      break;
    case 'OFFER_DRAW':
      result = handleOfferDraw(state, action);
      break;
    case 'RESPOND_DRAW':
      result = handleRespondDraw(state, action);
      break;
    case 'EXPAND':
      result = handleExpand(state, action);
      break;
    case 'MOVE':
      result = handleMove(state, action);
      break;
    default:
      result = null;
  }

  if (!result) return state;

  // Mandatory version increment so clients can tell which state is newer
  result.version = (state.version || 0) + 1;
  return result;
}

function handleSetName(state: GameState, action: SetNameAction): GameState | null {
  const name = typeof action.name === 'string' ? action.name.trim().slice(0, 16) : '';
  if (!name || state.names[action.player] === name) return null;

  const next = structuredClone(state);
  next.names[action.player] = name;
  return next;
}

function handleResign(state: GameState, action: ResignAction): GameState | null {
  if (action.player !== 'WHITE' && action.player !== 'BLACK') return null;

  const next = structuredClone(state);
  next.status = action.player === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN';
  next.endReason = 'RESIGNATION';
  next.drawOffer = null;
  return next;
}

function handleReady(state: GameState, action: ReadyAction): GameState | null {
  if (action.player !== 'WHITE' && action.player !== 'BLACK') return null;
  if (state.ready[action.player]) return null;

  const next = structuredClone(state);
  next.ready[action.player] = true;
  return next;
}

function handleOfferDraw(state: GameState, action: OfferDrawAction): GameState | null {
  if (action.player !== 'WHITE' && action.player !== 'BLACK') return null;
  if (!canOfferDraw(state, action.player)) return null;

  const next = structuredClone(state);
  next.drawOffer = action.player;
  next.drawOfferPly[action.player] = state.history.length;
  return next;
}

function handleRespondDraw(state: GameState, action: RespondDrawAction): GameState | null {
  if (action.player !== 'WHITE' && action.player !== 'BLACK') return null;
  // Only the opponent of the player who offered can answer
  if (state.drawOffer !== opponentOf(action.player)) return null;

  const next = structuredClone(state);
  next.drawOffer = null;
  if (action.accept === true) {
    next.status = 'DRAW';
    next.endReason = 'AGREEMENT';
  }
  return next;
}

function handleExpand(state: GameState, action: ExpandAction): GameState | null {
  if (!getLegalExpansionTargets(state).includes(action.cellId)) return null;

  const next = structuredClone(state);
  next.board[action.cellId].active = true;
  next.board[action.cellId].stabilizingUntil = next.currentPlayer;

  next.lastExpansion = action.cellId;
  next.lastMove = null; // Clear move highlight if expansion is the latest
  next.halfMoveClock += 1;
  next.history.push(action);

  endTurn(next);
  next.notation.push(describeExpansion(action.cellId, next));
  return next;
}

function handleMove(state: GameState, move: MoveAction): GameState | null {
  const piece = state.pieces[move.pieceId];
  if (!piece || piece.owner !== state.currentPlayer) return null;

  const legal = getLegalMoves(state, move.pieceId).find(m =>
    m.toCellId === move.toCellId &&
    m.promotionTo === move.promotionTo &&
    m.isCastling === move.isCastling
  );
  if (!legal) return null;

  const next = structuredClone(state);
  next.lastMove = { from: piece.cellId, to: legal.toCellId, pieceType: piece.type };
  next.lastExpansion = null; // Clear expansion highlight if move is latest

  const captured = applyMove(next, legal);
  next.halfMoveClock = captured || piece.type === 'PAWN' ? 0 : next.halfMoveClock + 1;
  next.history.push(legal);

  endTurn(next);
  next.notation.push(describeMove(state, legal, next));
  return next;
}

function endTurn(state: GameState): void {
  // Playing on instead of answering a pending draw offer declines it
  if (state.drawOffer === opponentOf(state.currentPlayer)) state.drawOffer = null;

  const nextPlayer = opponentOf(state.currentPlayer);
  state.currentPlayer = nextPlayer;

  // Cells this player placed on their previous turn are now fully part of the board
  for (const cell of Object.values(state.board)) {
    if (cell.stabilizingUntil === nextPlayer) {
      cell.stabilizingUntil = null;
    }
  }

  checkGameEnd(state);
}

/**
 * A turn is either a move or an expansion, and expansions are forbidden while in check, so:
 * - in check with no legal move  -> checkmate
 * - not in check, no legal move AND no legal expansion -> stalemate (draw)
 * - not in check, no legal move but an expansion exists -> the game goes on (the player must expand)
 */
function checkGameEnd(state: GameState): void {
  const color = state.currentPlayer;
  if (hasAnyLegalMove(state, color)) return;

  if (isInCheck(state, color)) {
    state.status = color === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN';
    state.endReason = 'CHECKMATE';
  } else if (getLegalExpansionTargets(state).length === 0) {
    state.status = 'DRAW';
    state.endReason = 'STALEMATE';
  }
}
