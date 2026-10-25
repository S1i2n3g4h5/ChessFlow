import React from 'react';
import { PieceSVG } from './PieceSVG';
import { PlayerColor } from '../game/types';

const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export function PlayerTag({ color, name, clock, isTurn, isUser, untimed = false, thinking = false }: {
    color: PlayerColor,
    name: string,
    clock: number,
    isTurn: boolean,
    isUser: boolean,
    untimed?: boolean,
    thinking?: boolean,
}) {
    const displayName = name || (color === 'WHITE' ? 'White' : 'Black');
    const lowTime = !untimed && isTurn && clock < 60;

    return (
        <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border transition-colors ${isTurn ? 'border-accent/70 bg-accent/[0.07]' : 'border-line bg-surface'}`}>
            <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${color === 'WHITE' ? 'bg-[#dbe4f0]' : 'bg-raised border border-line-strong'}`}>
                    <PieceSVG type="KING" color={color} size="70%" />
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span data-testid="player-name" className="font-semibold text-ink truncate">{displayName}</span>
                        {isUser && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-raised text-muted border border-line">You</span>}
                    </div>
                    <div className="text-xs text-muted flex items-center gap-2">
                        <span>{color === 'WHITE' ? 'White' : 'Black'}</span>
                        {thinking ? (
                            <span data-testid="bot-thinking" className="flex items-center gap-1.5 text-accent">
                                <span className="flex gap-0.5" aria-hidden="true">
                                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse"></span>
                                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse [animation-delay:150ms]"></span>
                                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse [animation-delay:300ms]"></span>
                                </span>
                                Thinking
                            </span>
                        ) : isTurn && <span className="text-accent">to move</span>}
                    </div>
                </div>
            </div>
            {untimed ? (
                <div data-testid="player-clock" className="text-sm font-medium text-muted">Untimed</div>
            ) : (
                <div data-testid="player-clock" className={`font-display text-2xl font-semibold tabular-nums ${lowTime ? 'text-danger' : isTurn ? 'text-ink' : 'text-muted'}`}>
                    {formatTime(clock)}
                </div>
            )}
        </div>
    );
}
