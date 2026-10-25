import { DEFAULT_IDLE_LIMIT_MS, RoomConfig } from './roomStore';

/**
 * Server-only room configuration. Passcodes never reach the browser bundle.
 * Override them on the host with environment variables, e.g.
 *   CHESSFLOW_PASSCODE_ALPHA=mysecret CHESSFLOW_PASSCODE_BETA=other npm start
 */
export const ROOM_CONFIGS: RoomConfig[] = [
  { id: 'ALPHA', name: 'Arena Alpha', passcode: process.env.CHESSFLOW_PASSCODE_ALPHA || 'ARCHON' },
  { id: 'BETA', name: 'Arena Beta', passcode: process.env.CHESSFLOW_PASSCODE_BETA || 'PHANTOM' },
];

/** Inactivity limit before a room is closed (default 3 hours; tests use a few seconds). */
export const ROOM_IDLE_LIMIT_MS = Number(process.env.CHESSFLOW_ROOM_IDLE_MS) || DEFAULT_IDLE_LIMIT_MS;
