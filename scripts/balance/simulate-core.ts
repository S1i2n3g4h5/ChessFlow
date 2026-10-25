import { GameState, PlayerColor, TurnAction } from '../../src/game/types';
import { createInitialGameState, getPieceAt } from '../../src/game/utils';
import { gameReducer } from '../../src/game/reducer';
import { getLegalMoves } from '../../src/game/engine';
import { chooseAction } from '../../src/game/ai/bot';
import { PIECE_VALUE } from '../../src/game/ai/evaluate';

/**
 * Bot-vs-bot games for the balance report. Every game is reproducible from its seed:
 * the opening is randomised for a few half-moves (so games differ), then both sides play
 * the Medium search with a fixed node budget per move (deterministic, independent of CPU speed).
 */

export interface BotSpec {
  label: string;
  maxNodes: number;
  noExpansions?: boolean;
}

export interface GameRecord {
  seed: number;
  white: string;
  black: string;
  winner: PlayerColor | null;
  endReason: 'CHECKMATE' | 'STALEMATE' | 'MOVE_LIMIT';
  plies: number;
  expansions: Record<PlayerColor, number>;
  expansionPlies: number[];
  firstExpansionPly: number | null;
  activeCells: number[];        // active cells after every 10 half-moves (index 0 = start)
  captures: number;
  promotions: number;
  materialAtEnd: number;        // White minus Black, centipawns
  adjudicated: PlayerColor | null; // at the move limit: side ahead by >= ADJUDICATION_CP of material
}

/** Standard engine-testing practice: a game stopped at the move limit goes to a side 3+ pawns up. */
export const ADJUDICATION_CP = 300;

export const RANDOM_OPENING_PLIES = 4;

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECE_CP: Record<string, number> = { PAWN: PIECE_VALUE[1], KNIGHT: PIECE_VALUE[2], BISHOP: PIECE_VALUE[3], ROOK: PIECE_VALUE[4], QUEEN: PIECE_VALUE[5], KING: 0 };

function material(state: GameState): number {
  let m = 0;
  for (const p of Object.values(state.pieces)) m += (p.owner === 'WHITE' ? 1 : -1) * PIECE_CP[p.type];
  return m;
}

const activeCount = (state: GameState) => Object.values(state.board).filter(c => c.active).length;

export function playGame(seed: number, white: BotSpec, black: BotSpec, maxPlies = 200): GameRecord {
  const random = seededRandom(seed);
  let state = createInitialGameState();
  const record: GameRecord = {
    seed, white: white.label, black: black.label, winner: null, endReason: 'MOVE_LIMIT', plies: 0,
    expansions: { WHITE: 0, BLACK: 0 }, expansionPlies: [], firstExpansionPly: null,
    activeCells: [activeCount(state)], captures: 0, promotions: 0, materialAtEnd: 0, adjudicated: null,
  };

  for (let ply = 0; ply < maxPlies && state.status === 'ONGOING'; ply++) {
    const mover = state.currentPlayer;
    let action: TurnAction;
    if (ply < RANDOM_OPENING_PLIES) {
      const moves = Object.values(state.pieces).filter(p => p.owner === mover).flatMap(p => getLegalMoves(state, p.id));
      action = moves[Math.floor(random() * moves.length)];
    } else {
      const spec = mover === 'WHITE' ? white : black;
      action = chooseAction(state, 'MEDIUM', random, {
        timeMs: 60_000, maxNodes: spec.maxNodes, maxDepth: 6, noExpansions: spec.noExpansions,
      }).action;
    }

    if (action.type === 'EXPAND') {
      record.expansions[mover]++;
      record.expansionPlies.push(ply);
      if (record.firstExpansionPly === null) record.firstExpansionPly = ply;
    } else if (action.type === 'MOVE') {
      if (getPieceAt(state, action.toCellId)) record.captures++;
      if (action.promotionTo) record.promotions++;
    }

    const next = gameReducer(state, action);
    if (next === state) throw new Error(`Illegal action in simulation (seed ${seed}, ply ${ply})`);
    state = next;
    record.plies = ply + 1;
    if (record.plies % 10 === 0) record.activeCells.push(activeCount(state));
  }

  if (state.status === 'WHITE_WIN' || state.status === 'BLACK_WIN') {
    record.winner = state.status === 'WHITE_WIN' ? 'WHITE' : 'BLACK';
    record.endReason = 'CHECKMATE';
  } else if (state.status === 'DRAW') {
    record.endReason = 'STALEMATE';
  }
  record.materialAtEnd = material(state);
  if (record.endReason === 'MOVE_LIMIT' && Math.abs(record.materialAtEnd) >= ADJUDICATION_CP) {
    record.adjudicated = record.materialAtEnd > 0 ? 'WHITE' : 'BLACK';
  }
  return record;
}
