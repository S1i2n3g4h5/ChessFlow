"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameState, PlayerColor, TurnAction } from '../game/types';
import { createInitialGameState } from '../game/utils';
import { gameReducer } from '../game/reducer';
import { isGameStarted } from '../game/clock';
import { getSavedName, saveName } from '../lib/session';
import { useCountdown } from './useCountdown';
import { GameController, Role } from './types';

export type RoomClosedReason = 'NOT_JOINED' | 'ROOM_EXPIRED' | 'UNKNOWN_ROOM';

interface RoomView {
  state: GameState;
  role: Role;
  playerCount: number;
}

const POLL_MS = 1000;

function sameClocks(a: Record<PlayerColor, number>, b: Record<PlayerColor, number>) {
  return a.WHITE === b.WHITE && a.BLACK === b.BLACK;
}

async function post(body: object): Promise<{ status: number; data: (RoomView & { error?: string }) | null }> {
  const res = await fetch('/api/game', {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/**
 * Online room controller: polls the server once per second, applies your own actions
 * optimistically, and only re-renders the board when the game actually changed.
 */
export function useOnlineGame(roomId: string, sessionId: string, onClosed: (reason: RoomClosedReason) => void): GameController {
  const [game, setGame] = useState<GameState>(() => createInitialGameState());
  const [serverClocks, setServerClocks] = useState(game.clocks);
  const [role, setRole] = useState<Role>('SPECTATOR');
  const [playerCount, setPlayerCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localName, setLocalName] = useState('');
  const gameRef = useRef(game);
  const roleRef = useRef<Role>('SPECTATOR');
  const pendingActions = useRef(0);
  const onClosedRef = useRef(onClosed);
  // False once this room screen is gone or the room was reported closed: late responses from
  // requests that were already in flight must not close the room you have just rejoined.
  const liveRef = useRef(true);

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    setLocalName(getSavedName());
  }, []);

  /** Takes a state from the server unless it is an older version of the game we already show. */
  const acceptState = useCallback((remote: GameState, force = false) => {
    const local = gameRef.current;
    const sameGame = remote.gameId === local.gameId;
    if (!force && sameGame && remote.version < local.version) return;
    if (!sameGame || remote.version !== local.version || remote.status !== local.status) {
      gameRef.current = remote;
      setGame(remote);
    }
    setServerClocks(prev => (sameClocks(prev, remote.clocks) ? prev : remote.clocks));
  }, []);

  const acceptView = useCallback((view: RoomView) => {
    roleRef.current = view.role;
    setRole(view.role);
    setPlayerCount(view.playerCount);
  }, []);

  const handleError = useCallback((status: number, error: string | undefined) => {
    if (error === 'ROOM_EXPIRED' || error === 'NOT_JOINED' || error === 'UNKNOWN_ROOM') {
      if (liveRef.current) {
        liveRef.current = false;
        onClosedRef.current(error);
      }
      return true;
    }
    if (status >= 500) setSyncError('Server error. Retrying...');
    return false;
  }, []);

  const sendAction = useCallback(async (action: TurnAction) => {
    pendingActions.current += 1;
    try {
      const { status, data } = await post({ op: 'action', roomId, sessionId, action });
      if (data && !data.error) {
        acceptView(data);
        acceptState(data.state, true);
        setSyncError(null);
      } else if (!handleError(status, data?.error)) {
        // Rejected by the server (e.g. out of turn): show the server's version of the game
        const res = await fetch(`/api/game?roomId=${roomId}&sessionId=${sessionId}`, { cache: 'no-store' });
        const fresh = await res.json().catch(() => null);
        if (fresh?.state) acceptState(fresh.state, true);
      }
    } catch {
      setSyncError('Failed to sync action. Retrying...');
    } finally {
      pendingActions.current -= 1;
    }
  }, [roomId, sessionId, acceptState, acceptView, handleError]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/game?roomId=${roomId}&sessionId=${sessionId}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.state) {
        handleError(res.status, data?.error);
        return;
      }
      acceptView(data);
      setSyncError(null);
      if (pendingActions.current > 0) return; // our own action is in flight; its response will update us
      acceptState(data.state);

      // Announce our saved name if our seat has none yet
      const view = data as RoomView;
      if (view.role !== 'SPECTATOR' && !view.state.names[view.role]) {
        const name = getSavedName();
        if (name) sendAction({ type: 'SET_NAME', player: view.role, name });
      }
    } catch {
      setSyncError('Connection unstable. Retrying...');
    }
  }, [roomId, sessionId, acceptState, acceptView, handleError, sendAction]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const dispatch = useCallback((action: TurnAction) => {
    const current = gameRef.current;
    const myRole = roleRef.current;
    if (myRole === 'SPECTATOR') return;
    if ((action.type === 'MOVE' || action.type === 'EXPAND') && current.currentPlayer !== myRole) return;
    const own = action.type === 'MOVE' || action.type === 'EXPAND' ? action : { ...action, player: myRole };

    const next = gameReducer(current, own);
    if (next === current) return; // rejected by the rules engine: nothing to send

    gameRef.current = next;
    setGame(next);
    sendAction(own);
  }, [sendAction]);

  const setName = useCallback((name: string) => {
    saveName(name);
    setLocalName(name);
    const myRole = roleRef.current;
    if (myRole !== 'SPECTATOR') dispatch({ type: 'SET_NAME', player: myRole, name });
  }, [dispatch]);

  const startNewGame = useCallback(async () => {
    if (roleRef.current === 'SPECTATOR') return;
    try {
      const { status, data } = await post({ op: 'reset', roomId, sessionId });
      if (data && !data.error) {
        acceptView(data);
        acceptState(data.state, true);
      } else {
        handleError(status, data?.error);
      }
    } catch {
      setSyncError('Failed to start a new game. Try again.');
    }
  }, [roomId, sessionId, acceptState, acceptView, handleError]);

  const running = isGameStarted(game, playerCount) && game.status === 'ONGOING';
  const clocks = useCountdown(serverClocks, game.currentPlayer, running);

  return {
    mode: 'ONLINE',
    game,
    clocks,
    clocksEnabled: true,
    role,
    playerCount,
    waitingForOpponent: playerCount < 2,
    needsName: role !== 'SPECTATOR' && !game.names[role] && !localName,
    dispatch,
    setName,
    startNewGame,
    syncError,
  };
}
