import { BoardAction, EndReason, GameStatus, PlayerColor } from '../game/types';
import { BotLevel } from '../game/ai/bot';

/**
 * Computer games live only in this browser (localStorage) - no server, no database.
 * A saved game can be resumed after a reload, but is discarded after 3 hours without a move.
 */

export interface ComputerSettings {
  level: BotLevel;
  humanColor: PlayerColor;
  timeControl: number | null; // seconds per player, null = untimed
}

export interface SavedComputerGame {
  v: 1;
  settings: ComputerSettings;
  history: BoardAction[];
  status: GameStatus;
  endReason: EndReason | null;
  clocksMs: Record<PlayerColor, number>;
  lastActivity: number;
}

const GAME_KEY = 'chessflow_computer_game';
const SETTINGS_KEY = 'chessflow_computer_settings';
const IDLE_OVERRIDE_KEY = 'chessflow_test_idle_ms'; // browser tests only
export const COMPUTER_IDLE_LIMIT_MS = 3 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS: ComputerSettings = { level: 'MEDIUM', humanColor: 'WHITE', timeControl: null };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the game still works, it just won't survive a reload
  }
}

export function idleLimitMs(): number {
  const override = Number(read<number>(IDLE_OVERRIDE_KEY));
  return override > 0 ? override : COMPUTER_IDLE_LIMIT_MS;
}

export function loadSettings(): ComputerSettings {
  return { ...DEFAULT_SETTINGS, ...(read<Partial<ComputerSettings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(settings: ComputerSettings) {
  write(SETTINGS_KEY, settings);
}

export type LoadedGame = { game: SavedComputerGame; expired: false } | { game: null; expired: boolean };

/** The saved computer game, unless it has been idle for longer than the limit. */
export function loadComputerGame(now = Date.now()): LoadedGame {
  const saved = read<SavedComputerGame>(GAME_KEY);
  if (!saved || saved.v !== 1 || !Array.isArray(saved.history)) return { game: null, expired: false };
  if (now - saved.lastActivity > idleLimitMs()) {
    clearComputerGame();
    return { game: null, expired: true };
  }
  return { game: saved, expired: false };
}

export function saveComputerGame(game: SavedComputerGame) {
  write(GAME_KEY, game);
}

export function clearComputerGame() {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    // ignore
  }
}
