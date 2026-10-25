import React, { useEffect, useState } from 'react';
import { ArrowLeft, Lock, ChevronRight } from 'lucide-react';
import { btn, pageTitle } from './ui';

interface RoomInfo {
    id: string;
    name: string;
}

interface Props {
    sessionId: string;
    /** Room to open the passcode screen for straight away (from ?room= in the URL). */
    initialRoom?: string | null;
    /** Message shown above the rooms, e.g. after a room was closed for inactivity. */
    notice?: string | null;
    onJoined: (roomId: string) => void;
    onBack?: () => void;
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Room + passcode screen. The passcode is checked by the server; the browser never knows it. */
export function RoomSelector({ sessionId, initialRoom, notice, onJoined, onBack }: Props) {
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const [selectedArena, setSelectedArena] = useState<string | null>(initialRoom ?? null);
    const [passcode, setPasscode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch('/api/game')
            .then(res => res.json())
            .then(data => setRooms(Array.isArray(data.rooms) ? data.rooms : []))
            .catch(() => setError('Cannot reach the server.'));
    }, []);

    const selected = rooms.find(r => r.id === selectedArena);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedArena || busy) return;
        setBusy(true);
        try {
            const res = await fetch('/api/game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op: 'join', roomId: selectedArena, sessionId, passcode }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data && !data.error) {
                onJoined(selectedArena);
                return;
            }
            setError(data?.error === 'WRONG_PASSCODE' || data?.error === 'PASSCODE_REQUIRED' ? 'Wrong passcode' : 'Could not join. Try again.');
            setTimeout(() => setError(null), 2500);
        } catch {
            setError('Cannot reach the server.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[500] bg-canvas overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-16">
                {onBack && (
                    <button data-testid="rooms-back" onClick={onBack} className={`${btn.ghost} -ml-3`}>
                        <ArrowLeft size={16} /> Menu
                    </button>
                )}

                <h1 className={`${pageTitle} mt-6`}>{selectedArena ? `Join ${selected?.name ?? selectedArena}` : 'Play online'}</h1>
                <p className="mt-2 text-muted">
                    {selectedArena
                        ? 'Enter the room passcode. The first player is White, the second Black; anyone after that watches.'
                        : 'Pick a room. Each room seats two players; anyone else can watch.'}
                </p>

                {notice && (
                    <div data-testid="room-notice" role="status" className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
                        {notice}
                    </div>
                )}

                {!selectedArena ? (
                    <div className="mt-8 grid md:grid-cols-2 gap-4">
                        {rooms.map((room) => (
                            <button
                                key={room.id}
                                data-testid={`room-card-${room.id}`}
                                onClick={() => setSelectedArena(room.id)}
                                className={`group flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 text-left transition-colors hover:border-line-strong hover:bg-raised ${focus}`}
                            >
                                <span>
                                    <span className="block font-display text-2xl font-semibold text-ink">{room.name}</span>
                                    <span className="mt-1 flex items-center gap-1.5 text-sm text-muted"><Lock size={14} /> Passcode required</span>
                                </span>
                                <ChevronRight size={20} className="text-muted group-hover:text-ink" />
                            </button>
                        ))}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="mt-8 max-w-sm">
                        <label htmlFor="room-passcode" className="block text-xs font-semibold text-muted">Passcode</label>
                        <input
                            id="room-passcode"
                            autoFocus
                            data-testid="passcode-input"
                            type="password"
                            autoComplete="off"
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            aria-invalid={Boolean(error)}
                            className={`mt-2 w-full rounded-xl border bg-surface px-4 py-3 text-lg text-ink outline-none transition-colors ${error ? 'border-danger' : 'border-line-strong focus:border-accent'}`}
                        />
                        <p className="mt-2 min-h-5 text-sm" aria-live="polite">
                            {error && <span data-testid="passcode-error" className="text-danger">{error}</span>}
                        </p>
                        <div className="mt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={() => { setSelectedArena(null); setPasscode(''); setError(null); }}
                                className={btn.secondary}
                            >
                                Back
                            </button>
                            <button type="submit" data-testid="passcode-submit" disabled={busy || !passcode} className={`${btn.primary} flex-1`}>
                                {busy ? 'Checking…' : 'Join room'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
