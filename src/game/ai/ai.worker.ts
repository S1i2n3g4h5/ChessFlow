/// <reference lib="webworker" />
import { chooseAction, respondToDraw, BotLevel } from './bot';
import { GameState, PlayerColor } from '../types';

/**
 * Runs the computer opponent off the main thread, so the page stays smooth while it thinks.
 *   in:  { id, kind: 'move', state, level } | { id, kind: 'draw', state, color }
 *   out: { id, kind: 'move', decision } | { id, kind: 'draw', accept } | { id, error }
 */
export type WorkerRequest =
  | { id: number; kind: 'move'; state: GameState; level: BotLevel }
  | { id: number; kind: 'draw'; state: GameState; color: PlayerColor };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.kind === 'move') {
      self.postMessage({ id: req.id, kind: 'move', decision: chooseAction(req.state, req.level) });
    } else {
      self.postMessage({ id: req.id, kind: 'draw', accept: respondToDraw(req.state, req.color) });
    }
  } catch (e) {
    self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};
