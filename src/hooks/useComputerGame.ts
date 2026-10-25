"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameState, PlayerColor, TurnAction } from '../game/types';
import { createInitialGameState, opponentOf } from '../game/utils';
import { gameReducer } from '../game/reducer';
import { reconstructState } from '../game/playback';
import { getLegalExpansionTargets, getLegalMoves } from '../game/engine';
import { BOT_LEVELS, BotDecision, chooseAction, respondToDraw } from '../game/ai/bot';
import { ComputerSettings, SavedComputerGame, idleLimitMs, saveComputerGame } from '../lib/computerStorage';
import { getSavedName, hasSeenGuide } from '../lib/session';
import { GameController } from './types';

const MIN_THINK_MS = 450;    // even an instant answer is shown after a short pause, so it feels natural
const DRAW_REPLY_MS = 700;

type BotRequest =
  | { kind: 'move'; state: GameState; level: ComputerSettings['level'] }
  | { kind: 'draw'; state: GameState; color: PlayerColor };
type BotReply = { decision?: BotDecision; accept?: boolean; error?: string };

/** Same answer the worker would give, computed on the main thread (fallback if workers are unavailable). */
function answerLocally(req: BotRequest): BotReply {
  return req.kind === 'move'
    ? { decision: chooseAction(req.state, req.level) }
    : { accept: respondToDraw(req.state, req.color) };
}

/** Last-resort legal action, used only if the bot's answer were ever rejected by the rules engine. */
function anyLegalAction(state: GameState): TurnAction | null {
  for (const p of Object.values(state.pieces)) {
    if (p.owner !== state.currentPlayer) continue;
    const moves = getLegalMoves(state, p.id);
    if (moves.length) return moves[0];
  }
  const exps = getLegalExpansionTargets(state);
  return exps.length ? { type: 'EXPAND', cellId: exps[0] } : null;
}

const moverOf = (ply: number): PlayerColor => (ply % 2 === 0 ? 'WHITE' : 'BLACK');

function buildInitialGame(settings: ComputerSettings, saved: SavedComputerGame | null): GameState {
  let state = saved ? reconstructState(saved.history, saved.history.length - 1) : createInitialGameState();
  if (saved && state.status === 'ONGOING' && saved.status !== 'ONGOING') {
    // Resignations, agreed draws and timeouts are not part of the move history
    state = { ...state, status: saved.status, endReason: saved.endReason };
  }
  const human = settings.humanColor;
  // The computer is always ready; you are too, unless this browser has never seen the guide
  state.ready = { ...state.ready, [opponentOf(human)]: true, [human]: Boolean(saved) || hasSeenGuide() };
  state.names = {
    ...state.names,
    [human]: getSavedName() || 'PLAYER',
    [opponentOf(human)]: `ChessFlow AI · ${BOT_LEVELS[settings.level].label}`,
  };
  return state;
}

/**
 * Computer-opponent controller. Everything happens in this browser: the bot searches in a
 * Web Worker (so the page never freezes), and the game is saved to localStorage.
 */
export function useComputerGame(
  settings: ComputerSettings,
  saved: SavedComputerGame | null,
  onExpired: () => void,
  onNewGame: () => void,
): GameController {
  const human = settings.humanColor;
  const botColor = opponentOf(human);
  const timed = settings.timeControl !== null;

  const [game, setGame] = useState<GameState>(() => buildInitialGame(settings, saved));
  const [clocksMs, setClocksMs] = useState<Record<PlayerColor, number>>(() => saved?.clocksMs ?? {
    WHITE: (settings.timeControl ?? 0) * 1000,
    BLACK: (settings.timeControl ?? 0) * 1000,
  });
  const [turnStartedAt, setTurnStartedAt] = useState(() => Date.now());
  const [lastActivity, setLastActivity] = useState(() => saved?.lastActivity ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  const gameRef = useRef(game);
  const clocksRef = useRef(clocksMs);
  const turnStartRef = useRef(turnStartedAt);
  const lastActivityRef = useRef(lastActivity);
  const requestRef = useRef(0);
  const onExpiredRef = useRef(onExpired);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (reply: BotReply) => void>());
  const messageIdRef = useRef(0);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  // ---- Web Worker for the bot ----
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../game/ai/ai.worker.ts', import.meta.url));
    } catch {
      return;
    }
    const pending = pendingRef.current;
    worker.onmessage = (e: MessageEvent<BotReply & { id: number }>) => {
      const resolve = pending.get(e.data.id);
      pending.delete(e.data.id);
      resolve?.(e.data);
    };
    worker.onerror = () => {
      workerRef.current = null; // fall back to the main thread from now on
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  const ask = useCallback((req: BotRequest): Promise<BotReply> => new Promise(resolve => {
    const worker = workerRef.current;
    if (!worker) {
      setTimeout(() => resolve(answerLocally(req)), 20);
      return;
    }
    const id = ++messageIdRef.current;
    pendingRef.current.set(id, reply => resolve(reply.error ? answerLocally(req) : reply));
    worker.postMessage({ ...req, id });
  }), []);

  // ---- Applying a new state (always from event handlers / callbacks) ----
  const commit = useCallback((next: GameState, mover: PlayerColor | null) => {
    const t = Date.now();
    if (mover && timed) {
      const spent = Math.max(0, t - turnStartRef.current);
      const updated = { ...clocksRef.current, [mover]: Math.max(0, clocksRef.current[mover] - spent) };
      clocksRef.current = updated;
      setClocksMs(updated);
    }
    if (mover) {
      turnStartRef.current = t;
      setTurnStartedAt(t);
    }
    lastActivityRef.current = t;
    setLastActivity(t);
    gameRef.current = next;
    setGame(next);
  }, [timed]);

  const started = game.ready.WHITE && game.ready.BLACK;

  // ---- The computer's turn ----
  useEffect(() => {
    if (!started || game.status !== 'ONGOING' || game.currentPlayer !== botColor) return;
    const myRequest = ++requestRef.current; // undo bumps this to drop a pending answer
    const startedAt = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    ask({ kind: 'move', state: game, level: settings.level }).then(reply => {
      if (cancelled || requestRef.current !== myRequest || !reply.decision) return;
      const wait = Math.max(0, MIN_THINK_MS - (Date.now() - startedAt));
      timer = setTimeout(() => {
        if (cancelled || requestRef.current !== myRequest) return;
        const current = gameRef.current;
        if (current.status !== 'ONGOING' || current.currentPlayer !== botColor) return;
        let next = gameReducer(current, reply.decision!.action);
        if (next === current) {
          const fallback = anyLegalAction(current);
          if (!fallback) return;
          next = gameReducer(current, fallback);
        }
        commit(next, botColor);
      }, wait);
    });

    return () => {
      cancelled = true; // the game changed or the screen closed: ignore this answer
      if (timer) clearTimeout(timer);
    };
  }, [game, started, botColor, settings.level, ask, commit]);

  // ---- Clock, timeout and the 3-hour rule ----
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const g = gameRef.current;
      if (timed && g.status === 'ONGOING' && g.ready.WHITE && g.ready.BLACK) {
        const remaining = clocksRef.current[g.currentPlayer] - (t - turnStartRef.current);
        if (remaining <= 0) {
          const zeroed = { ...clocksRef.current, [g.currentPlayer]: 0 };
          clocksRef.current = zeroed;
          setClocksMs(zeroed);
          commit({ ...g, status: g.currentPlayer === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN', endReason: 'TIMEOUT', version: g.version + 1 }, null);
        }
      }
      if (t - lastActivityRef.current > idleLimitMs()) onExpiredRef.current();
    }, timed ? 250 : 1000);
    return () => clearInterval(id);
  }, [timed, commit]);

  // ---- Save to this browser after every change ----
  useEffect(() => {
    saveComputerGame({ v: 1, settings, history: game.history, status: game.status, endReason: game.endReason, clocksMs, lastActivity });
  }, [game, clocksMs, lastActivity, settings]);

  // ---- Player actions ----
  const dispatch = useCallback((action: TurnAction) => {
    const current = gameRef.current;
    if (current.status !== 'ONGOING') return;

    if (action.type === 'MOVE' || action.type === 'EXPAND') {
      if (current.currentPlayer !== human) return;
      const next = gameReducer(current, action);
      if (next !== current) commit(next, human);
      return;
    }

    if (action.type === 'READY') {
      const next = gameReducer(current, { type: 'READY', player: human });
      if (next === current) return;
      commit(next, null);
      turnStartRef.current = Date.now(); // the clock starts now, not when the screen opened
      setTurnStartedAt(turnStartRef.current);
      return;
    }

    if (action.type === 'RESIGN') {
      commit(gameReducer(current, { type: 'RESIGN', player: human }), null);
      return;
    }

    if (action.type === 'OFFER_DRAW') {
      const offered = gameReducer(current, { type: 'OFFER_DRAW', player: human });
      if (offered === current) return;
      commit(offered, null);
      setNotice(null);
      ask({ kind: 'draw', state: offered, color: botColor }).then(reply => {
        setTimeout(() => {
          const cur = gameRef.current;
          if (cur.drawOffer !== human) return; // already answered by the computer playing on
          const answered = gameReducer(cur, { type: 'RESPOND_DRAW', player: botColor, accept: reply.accept === true });
          if (answered === cur) return;
          commit(answered, null);
          if (!reply.accept) setNotice('The computer declined your draw offer.');
        }, DRAW_REPLY_MS);
      });
    }
  }, [human, botColor, ask, commit]);

  // ---- Undo: take back your last move (and the computer's reply) ----
  const thinking = started && game.status === 'ONGOING' && game.currentPlayer === botColor;
  const humanMoves = game.history.filter((_, i) => moverOf(i) === human).length;
  const finishedByChoice = game.status !== 'ONGOING' && (game.endReason === 'RESIGNATION' || game.endReason === 'TIMEOUT' || game.endReason === 'AGREEMENT');
  const canUndo = !thinking && humanMoves > 0 && !finishedByChoice;

  const undo = useCallback(() => {
    const g = gameRef.current;
    const n = g.history.length;
    if (n === 0) return;
    const target = n - (moverOf(n - 1) === botColor ? 2 : 1);
    if (target < 0 || moverOf(target) !== human) return;
    requestRef.current++; // drop any pending computer move
    const rebuilt = reconstructState(g.history.slice(0, target), target - 1);
    rebuilt.names = g.names;
    rebuilt.ready = g.ready;
    setNotice(null);
    commit(rebuilt, null);
    turnStartRef.current = Date.now();
    setTurnStartedAt(turnStartRef.current);
  }, [botColor, human, commit]);

  // ---- Display clocks ----
  const secondsLeft = (c: PlayerColor) => {
    if (!timed) return 0;
    const running = started && game.status === 'ONGOING' && game.currentPlayer === c;
    const elapsed = running ? Math.max(0, now - turnStartedAt) : 0;
    return Math.max(0, Math.ceil((clocksMs[c] - elapsed) / 1000));
  };

  return {
    mode: 'COMPUTER',
    game,
    clocks: { WHITE: secondsLeft('WHITE'), BLACK: secondsLeft('BLACK') },
    clocksEnabled: timed,
    role: human,
    playerCount: 2,
    waitingForOpponent: false,
    needsName: false,
    dispatch,
    setName: () => {},
    startNewGame: onNewGame,
    syncError: null,
    notice,
    thinkingColor: thinking ? botColor : null,
    canUndo,
    undo,
  };
}
