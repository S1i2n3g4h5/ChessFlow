import { describe, expect, it } from 'vitest';
import { createInitialGameState, getCellId } from '../utils';
import { gameReducer } from '../reducer';
import { canOfferDraw } from '../draw';
import { expand, play, sq } from './helpers';

const offer = (player: 'WHITE' | 'BLACK') => ({ type: 'OFFER_DRAW' as const, player });
const respond = (player: 'WHITE' | 'BLACK', accept: boolean) => ({ type: 'RESPOND_DRAW' as const, player, accept });

describe('draw by agreement', () => {
  it('an accepted offer ends the game as a draw by agreement', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    expect(state.drawOffer).toBe('WHITE');
    expect(state.status).toBe('ONGOING');
    state = gameReducer(state, respond('BLACK', true));
    expect(state.status).toBe('DRAW');
    expect(state.endReason).toBe('AGREEMENT');
    expect(state.drawOffer).toBeNull();
  });

  it('a declined offer just disappears', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    state = gameReducer(state, respond('BLACK', false));
    expect(state.status).toBe('ONGOING');
    expect(state.drawOffer).toBeNull();
  });

  it('can be offered when it is not your turn', () => {
    const state = gameReducer(createInitialGameState(), offer('BLACK'));
    expect(state.drawOffer).toBe('BLACK');
  });

  it('only the opponent can answer, and only a pending offer', () => {
    const fresh = createInitialGameState();
    expect(gameReducer(fresh, respond('BLACK', true))).toBe(fresh); // nothing pending
    const offered = gameReducer(fresh, offer('WHITE'));
    expect(gameReducer(offered, respond('WHITE', true))).toBe(offered); // can't accept your own offer
  });

  it('making a move instead of answering declines the offer', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    state = play(state, sq('e2'), sq('e4')); // White offered, then moved: offer still stands
    expect(state.drawOffer).toBe('WHITE');
    state = play(state, sq('e7'), sq('e5')); // Black plays on: declined
    expect(state.drawOffer).toBeNull();
    expect(state.status).toBe('ONGOING');
  });

  it('an expansion also counts as playing on', () => {
    let state = play(createInitialGameState(), sq('e2'), sq('e4'));
    state = gameReducer(state, offer('WHITE'));
    state = expand(state, getCellId(3, 10));
    expect(state.drawOffer).toBeNull();
  });

  it('allows only one offer at a time and one offer per full move', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    expect(gameReducer(state, offer('BLACK'))).toBe(state); // one already pending
    state = gameReducer(state, respond('BLACK', false));
    expect(canOfferDraw(state, 'WHITE')).toBe(false); // no move made since
    expect(gameReducer(state, offer('WHITE'))).toBe(state);
    expect(canOfferDraw(state, 'BLACK')).toBe(true);

    state = play(state, sq('e2'), sq('e4'));
    expect(canOfferDraw(state, 'WHITE')).toBe(false);
    state = play(state, sq('e7'), sq('e5'));
    expect(canOfferDraw(state, 'WHITE')).toBe(true);
  });

  it('cannot be offered or accepted once the game is over', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    state = gameReducer(state, { type: 'RESIGN', player: 'WHITE' });
    expect(state.drawOffer).toBeNull();
    expect(gameReducer(state, respond('BLACK', true))).toBe(state);
    expect(gameReducer(state, offer('BLACK'))).toBe(state);
  });

  it('does not touch the move history', () => {
    let state = gameReducer(createInitialGameState(), offer('WHITE'));
    state = gameReducer(state, respond('BLACK', false));
    expect(state.history).toEqual([]);
    expect(state.notation).toEqual([]);
    expect(state.version).toBe(2);
  });
});
