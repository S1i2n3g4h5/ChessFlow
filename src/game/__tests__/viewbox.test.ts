import { describe, expect, it } from 'vitest';
import { computeViewBox, createInitialGameState, getCellId, GRID_SIZE, ViewBox } from '../utils';
import { getLegalExpansionTargets } from '../engine';
import { GameState } from '../types';
import { expand, seededRandom } from './helpers';

/** Every active cell, drawn in screen space, lies fully inside the view box. */
function expectAllActiveCellsVisible(game: GameState, vb: ViewBox, flipped: boolean) {
  for (const cell of Object.values(game.board)) {
    if (!cell.active) continue;
    const x = flipped ? GRID_SIZE - 1 - cell.file : cell.file;
    const y = flipped ? cell.rank : GRID_SIZE - 1 - cell.rank;
    expect(x).toBeGreaterThanOrEqual(vb.x);
    expect(x + 1).toBeLessThanOrEqual(vb.x + vb.width);
    expect(y).toBeGreaterThanOrEqual(vb.y);
    expect(y + 1).toBeLessThanOrEqual(vb.y + vb.height);
  }
}

describe('board view box', () => {
  it('shows the whole 16x16 grid when the view is free', () => {
    expect(computeViewBox(createInitialGameState(), false, false)).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });

  it('frames the starting 8x8 board with two cells of padding when locked', () => {
    const state = createInitialGameState();
    expect(computeViewBox(state, false, true)).toEqual({ x: 2, y: 2, width: 12, height: 12 });
    expect(computeViewBox(state, true, true)).toEqual({ x: 2, y: 2, width: 12, height: 12 });
  });

  it('regression: Black\'s locked view keeps a board expanded to the right edge in frame', () => {
    const state = createInitialGameState();
    for (let f = 12; f < GRID_SIZE; f++) state.board[getCellId(f, 7)].active = true;
    for (const flipped of [false, true]) {
      expectAllActiveCellsVisible(state, computeViewBox(state, flipped, true), flipped);
    }
  });

  it('keeps every active cell visible from both sides through a long random expansion sequence', () => {
    const random = seededRandom(7);
    let state = createInitialGameState();
    for (let i = 0; i < 120; i++) {
      const targets = getLegalExpansionTargets(state);
      if (targets.length === 0) break;
      state = expand(state, targets[Math.floor(random() * targets.length)]);
      for (const flipped of [false, true]) {
        const vb = computeViewBox(state, flipped, true);
        expect(vb.width).toBe(vb.height);
        expect(vb.x).toBeGreaterThanOrEqual(0);
        expect(vb.y).toBeGreaterThanOrEqual(0);
        expect(vb.x + vb.width).toBeLessThanOrEqual(GRID_SIZE);
        expect(vb.y + vb.height).toBeLessThanOrEqual(GRID_SIZE);
        expectAllActiveCellsVisible(state, vb, flipped);
      }
    }
  });
});
