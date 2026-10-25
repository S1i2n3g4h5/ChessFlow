"use client";

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { RoomSelector } from '../components/RoomSelector';
import { GameScreen } from '../components/GameScreen';
import { HomeMenu } from '../components/HomeMenu';
import { ComputerSetup } from '../components/ComputerSetup';
import { HowToPlayGuide } from '../components/HowToPlayGuide';
import { RoomClosedReason, useOnlineGame } from '../hooks/useOnlineGame';
import { useComputerGame } from '../hooks/useComputerGame';
import { getSessionId } from '../lib/session';
import {
    ComputerSettings, SavedComputerGame, clearComputerGame, loadComputerGame, loadSettings, saveSettings,
} from '../lib/computerStorage';
import { BOT_LEVELS } from '../game/ai/bot';

const CLOSED_NOTICES: Record<RoomClosedReason, string> = {
    ROOM_EXPIRED: 'This room was closed after 3 hours of inactivity. Enter the passcode to start a new game.',
    NOT_JOINED: 'Your seat in this room has expired. Enter the passcode to join again.',
    UNKNOWN_ROOM: 'That room does not exist.',
};
const COMPUTER_EXPIRED = 'Your computer game was closed after 3 hours without a move.';

type View =
    | { kind: 'menu' }
    | { kind: 'rooms' }
    | { kind: 'online', roomId: string }
    | { kind: 'computer-setup' }
    | { kind: 'computer', settings: ComputerSettings, saved: SavedComputerGame | null, key: number };

function setRoomInUrl(roomId: string | null) {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set('room', roomId);
    else url.searchParams.delete('room');
    window.history.replaceState({}, '', url);
}

const ROOM_NAMES: Record<string, string> = { ALPHA: 'Arena Alpha', BETA: 'Arena Beta' };

function OnlineRoom({ roomId, sessionId, onClosed, onLeave }: { roomId: string, sessionId: string, onClosed: (reason: RoomClosedReason, roomId: string) => void, onLeave: () => void }) {
    const handleClosed = useCallback((reason: RoomClosedReason) => onClosed(reason, roomId), [onClosed, roomId]);
    const controller = useOnlineGame(roomId, sessionId, handleClosed);
    return <GameScreen controller={controller} headerLabel={`Online · ${ROOM_NAMES[roomId] ?? roomId}`} onLeave={onLeave} />;
}

function ComputerRoom({ settings, saved, onExpired, onNewGame, onLeave }: {
    settings: ComputerSettings, saved: SavedComputerGame | null, onExpired: () => void, onNewGame: () => void, onLeave: () => void,
}) {
    const controller = useComputerGame(settings, saved, onExpired, onNewGame);
    const time = settings.timeControl ? `${settings.timeControl / 60} min` : 'Untimed';
    return <GameScreen controller={controller} headerLabel={`vs Computer · ${BOT_LEVELS[settings.level].label} · ${time}`} onLeave={onLeave} />;
}

// Browser-only values (null during server rendering)
const noSubscribe = () => () => {};
let initialUrlRoom: string | null | undefined;
function readInitialUrlRoom(): string | null {
    if (initialUrlRoom === undefined) {
        initialUrlRoom = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? null;
    }
    return initialUrlRoom;
}
const readSavedComputerGame = () => {
    try {
        return localStorage.getItem('chessflow_computer_game');
    } catch {
        return null;
    }
};

export default function Home() {
    const sessionId = useSyncExternalStore(noSubscribe, getSessionId, () => null);
    const urlRoom = useSyncExternalStore(noSubscribe, readInitialUrlRoom, () => null);
    const savedRaw = useSyncExternalStore(noSubscribe, readSavedComputerGame, () => null);
    const [view, setView] = useState<View>({ kind: 'menu' });
    const [preselectedRoom, setPreselectedRoom] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [rejoinDone, setRejoinDone] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);

    // On load with ?room=: silently rejoin (e.g. after a reload), otherwise ask for that room's passcode
    useEffect(() => {
        if (!sessionId || !urlRoom) return;
        fetch('/api/game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'join', roomId: urlRoom, sessionId }),
        })
            .then(res => res.json().then(data => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
                if (ok && !data.error) setView({ kind: 'online', roomId: urlRoom });
                else if (data?.error === 'UNKNOWN_ROOM') setNotice(CLOSED_NOTICES.UNKNOWN_ROOM);
                else { setPreselectedRoom(urlRoom); setView({ kind: 'rooms' }); }
            })
            .catch(() => { setPreselectedRoom(urlRoom); setView({ kind: 'rooms' }); })
            .finally(() => setRejoinDone(true));
    }, [sessionId, urlRoom]);
    const checkingRejoin = Boolean(urlRoom) && !rejoinDone;

    // Saved computer game summary for the "Resume" button
    const resume = useMemo(() => {
        if (!savedRaw) return null;
        try {
            const saved = JSON.parse(savedRaw) as SavedComputerGame;
            if (saved.status !== 'ONGOING') return null;
            const moves = Math.ceil(saved.history.length / 2);
            return `vs Computer · ${BOT_LEVELS[saved.settings.level]?.label ?? ''} · move ${moves}`;
        } catch {
            return null;
        }
    }, [savedRaw]);

    const toMenu = useCallback((message: string | null = null) => {
        setRoomInUrl(null);
        setNotice(message);
        setView({ kind: 'menu' });
    }, []);

    const onJoined = useCallback((id: string) => {
        setNotice(null);
        setRoomInUrl(id);
        setView({ kind: 'online', roomId: id });
    }, []);

    // All three updates land in one render, so the passcode screen opens once, already on the right room
    const onClosed = useCallback((reason: RoomClosedReason, roomId: string) => {
        setPreselectedRoom(reason === 'UNKNOWN_ROOM' ? null : roomId);
        setNotice(CLOSED_NOTICES[reason]);
        setView({ kind: 'rooms' });
    }, []);

    const startComputer = useCallback((settings: ComputerSettings) => {
        saveSettings(settings);
        clearComputerGame();
        setNotice(null);
        setView({ kind: 'computer', settings, saved: null, key: Date.now() });
    }, []);

    const resumeComputer = useCallback(() => {
        const loaded = loadComputerGame();
        if (!loaded.game) {
            toMenu(loaded.expired ? COMPUTER_EXPIRED : null);
            return;
        }
        setNotice(null);
        setView({ kind: 'computer', settings: loaded.game.settings, saved: loaded.game, key: Date.now() });
    }, [toMenu]);

    const computerExpired = useCallback(() => {
        clearComputerGame();
        toMenu(COMPUTER_EXPIRED);
    }, [toMenu]);

    if (!sessionId || checkingRejoin) {
        return <div className="min-h-screen bg-canvas" />;
    }

    switch (view.kind) {
        case 'online':
            return <OnlineRoom key={view.roomId} roomId={view.roomId} sessionId={sessionId} onClosed={onClosed} onLeave={() => toMenu()} />;
        case 'rooms':
            return (
                <RoomSelector
                    key={preselectedRoom ?? 'none'}
                    sessionId={sessionId}
                    initialRoom={preselectedRoom}
                    notice={notice}
                    onJoined={onJoined}
                    onBack={() => { setPreselectedRoom(null); toMenu(); }}
                />
            );
        case 'computer-setup':
            return <ComputerSetup initial={loadSettings()} onStart={startComputer} onBack={() => toMenu()} />;
        case 'computer':
            return (
                <ComputerRoom
                    key={view.key}
                    settings={view.settings}
                    saved={view.saved}
                    onExpired={computerExpired}
                    onNewGame={() => setView({ kind: 'computer-setup' })}
                    onLeave={() => toMenu()}
                />
            );
        default:
            return (
                <>
                    <HomeMenu
                        notice={notice}
                        onOnline={() => { setNotice(null); setView({ kind: 'rooms' }); }}
                        onComputer={() => { setNotice(null); setView({ kind: 'computer-setup' }); }}
                        onHowToPlay={() => setGuideOpen(true)}
                        onResume={resume ? resumeComputer : undefined}
                        resumeLabel={resume ?? undefined}
                    />
                    {guideOpen && <HowToPlayGuide mode="reference" onClose={() => setGuideOpen(false)} />}
                </>
            );
    }
}
