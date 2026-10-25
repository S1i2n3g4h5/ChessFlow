import { GameState, PlayerColor, TurnAction } from '../types';
import { Position, toTurnAction } from './position';
import { SearchOptions, Searcher } from './search';

export type BotLevel = 'EASY' | 'MEDIUM' | 'HARD';

export interface BotLevelInfo {
  label: string;
  description: string;
  search: SearchOptions;
  /** Easy mode: pick randomly among moves within this many centipawns of the best one. */
  randomMarginCp?: number;
}

export const BOT_LEVELS: Record<BotLevel, BotLevelInfo> = {
  EASY: {
    label: 'Easy',
    description: 'Looks two moves ahead and sometimes picks a weaker move. Good for learning the rules.',
    search: { maxDepth: 2, timeMs: 400, expansionsPerNode: 2, rootExpansions: 6, exactRootScores: true },
    randomMarginCp: 120,
  },
  MEDIUM: {
    label: 'Medium',
    description: 'Thinks about a second per move. Punishes loose pieces and uses expansions.',
    search: { maxDepth: 5, timeMs: 1000, expansionsPerNode: 3, rootExpansions: 8 },
  },
  HARD: {
    label: 'Hard',
    description: 'Searches deeper for up to three seconds per move. Plays for the long game.',
    search: { maxDepth: 12, timeMs: 2800, expansionsPerNode: 4, rootExpansions: 12 },
  },
};

export interface BotDecision {
  action: TurnAction;
  score: number;      // centipawns, from the bot's point of view
  depth: number;
  nodes: number;
  elapsedMs: number;
}

/**
 * Picks the computer's action for the side to move. Pure function of the game state
 * (plus `random` for Easy mode), so it runs identically in a Web Worker, in tests and in scripts.
 */
export function chooseAction(state: GameState, level: BotLevel, random: () => number = Math.random, overrides?: Partial<SearchOptions>): BotDecision {
  const info = BOT_LEVELS[level];
  const pos = Position.fromGameState(state);
  const result = new Searcher(pos).search({ ...info.search, ...overrides });

  let move = result.move;
  if (info.randomMarginCp !== undefined && result.rootScores.length > 1) {
    const good = result.rootScores.filter(s => s.score >= result.score - info.randomMarginCp!);
    move = good[Math.floor(random() * good.length)].move;
  }

  return {
    action: toTurnAction(state, move),
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
}

/**
 * Should the computer (playing `color`) accept a draw offer? Only when it is clearly worse,
 * or when the position is dead level after a long game.
 */
export function respondToDraw(state: GameState, color: PlayerColor): boolean {
  const asMover = { ...state, currentPlayer: color };
  const pos = Position.fromGameState(asMover);
  const result = new Searcher(pos).search({ maxDepth: 3, timeMs: 400, expansionsPerNode: 2, rootExpansions: 4 });
  if (result.score <= -200) return true;
  return state.history.length >= 80 && Math.abs(result.score) <= 30;
}
