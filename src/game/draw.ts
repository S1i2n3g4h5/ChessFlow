import { GameState, PlayerColor } from './types';

/**
 * Draw by agreement. A player may offer a draw at any time during the game when:
 * - no offer is already pending, and
 * - at least two half-moves have been played since their own previous offer
 *   (one offer per full move, so offers cannot be spammed).
 * The opponent accepts or declines; making a move instead also declines.
 */
export function canOfferDraw(state: GameState, color: PlayerColor): boolean {
  if (state.status !== 'ONGOING' || state.drawOffer !== null) return false;
  const last = state.drawOfferPly[color];
  return last === null || state.history.length >= last + 2;
}
