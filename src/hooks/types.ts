import { GameState, PlayerColor, TurnAction } from '../game/types';

export type Role = PlayerColor | 'SPECTATOR';

/**
 * Everything the game screen needs, independent of where the game is played
 * (an online room, or the computer opponent in this browser).
 */
export interface GameController {
  mode: 'ONLINE' | 'COMPUTER';
  game: GameState;
  clocks: Record<PlayerColor, number>; // display clocks in seconds
  clocksEnabled: boolean;              // false for untimed computer games
  role: Role;
  playerCount: number;                 // seated players (0-2)
  waitingForOpponent: boolean;         // show the lobby
  needsName: boolean;                  // show the name prompt
  dispatch: (action: TurnAction) => void;
  setName: (name: string) => void;
  startNewGame: () => void;
  syncError: string | null;
  notice?: string | null;              // short informational message (e.g. draw declined)
  /** Computer games only */
  thinkingColor?: PlayerColor | null;  // the computer is searching for a move
  canUndo?: boolean;
  undo?: () => void;
}
