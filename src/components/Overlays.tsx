import React, { useState } from 'react';
import { EndReason, GameStatus, PlayerColor, PieceType } from '../game/types';
import { PieceSVG } from './PieceSVG';
import { Trophy, Handshake, Users } from 'lucide-react';
import { backdrop, btn, dialog } from './ui';

const PIECE_NAMES: Record<PieceType, string> = { QUEEN: 'Queen', ROOK: 'Rook', BISHOP: 'Bishop', KNIGHT: 'Knight', KING: 'King', PAWN: 'Pawn' };

export function PromotionOverlay({ color, onSelect }: { color: PlayerColor, onSelect: (type: PieceType) => void }) {
    const pieces: PieceType[] = ['QUEEN', 'ROOK', 'BISHOP', 'KNIGHT'];

    return (
        <div data-testid="promotion-overlay" className={`${backdrop} z-[400]`}>
            <div role="dialog" aria-label="Promote your pawn" className={`${dialog} max-w-md`}>
                <h2 className="font-display text-2xl font-semibold">Promote your pawn</h2>
                <p className="mt-1 text-sm text-muted">Choose the piece it becomes.</p>
                <div className="mt-6 grid grid-cols-4 gap-3">
                    {pieces.map((type) => (
                        <button
                            key={type}
                            data-testid={`promote-${type}`}
                            onClick={() => onSelect(type)}
                            className="flex flex-col items-center gap-2 rounded-xl border border-line bg-raised p-3 hover:border-accent hover:bg-accent/10 transition-colors focus-visible:outline-2 focus-visible:outline-accent"
                        >
                            <span className="w-12 h-12"><PieceSVG type={type} color={color} size="100%" /></span>
                            <span className="text-xs font-medium text-muted">{PIECE_NAMES[type]}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function SetupOverlay({ onSetName }: { onSetName: (name: string) => void }) {
    const [nameInput, setNameInput] = useState('');
    const valid = nameInput.trim().length >= 2;

    return (
        <div data-testid="name-overlay" className="fixed inset-0 z-[200] bg-canvas flex items-center justify-center p-4">
            <form
                className={`${dialog} max-w-sm`}
                onSubmit={(e) => { e.preventDefault(); if (valid) onSetName(nameInput.trim()); }}
            >
                <h2 className="font-display text-2xl font-semibold">Choose a name</h2>
                <p className="mt-1 text-sm text-muted">Your opponent will see it next to your clock.</p>
                <label htmlFor="player-name" className="mt-6 block text-xs font-semibold text-muted">Display name</label>
                <input
                    id="player-name"
                    type="text"
                    autoFocus
                    data-testid="name-input"
                    placeholder="ENTER CALLSIGN..."
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value.toUpperCase().slice(0, 16))}
                    className="mt-2 w-full rounded-xl border border-line-strong bg-canvas px-4 py-3 text-lg font-semibold tracking-wide text-ink placeholder:text-muted/60 outline-none focus:border-accent"
                />
                <p className="mt-2 text-xs text-muted">2 to 16 characters.</p>
                <button type="submit" disabled={!valid} className={`${btn.primary} mt-6 w-full`}>Continue</button>
            </form>
        </div>
    );
}

const END_REASON_TEXT: Record<EndReason, string> = {
    CHECKMATE: 'by checkmate',
    STALEMATE: 'by stalemate (no move and no expansion left)',
    RESIGNATION: 'by resignation',
    TIMEOUT: 'on time',
    AGREEMENT: 'by agreement (½–½)',
};

export function GameOverOverlay({ status, endReason, names, canStartNew, onNewGame, onReview }: {
    status: GameStatus,
    endReason: EndReason | null,
    names: Record<PlayerColor, string>,
    canStartNew: boolean,
    onNewGame: () => void,
    onReview: () => void,
}) {
    const winner: PlayerColor | null = status === 'WHITE_WIN' ? 'WHITE' : status === 'BLACK_WIN' ? 'BLACK' : null;
    const headline = winner ? `${names[winner] || (winner === 'WHITE' ? 'White' : 'Black')} wins` : 'Draw';
    const detail = winner
        ? `${winner === 'WHITE' ? 'White' : 'Black'} wins ${endReason ? END_REASON_TEXT[endReason] : ''}.`
        : `Game drawn ${endReason ? END_REASON_TEXT[endReason] : ''}.`;

    return (
        <div data-testid="game-over" className={`${backdrop} z-[100]`}>
            <div role="dialog" aria-label="Game over" className={`${dialog} max-w-md text-center`}>
                <div className="mx-auto w-14 h-14 rounded-2xl border border-line-strong bg-raised flex items-center justify-center">
                    {winner ? <Trophy size={26} className="text-warn" /> : <Handshake size={26} className="text-accent" />}
                </div>
                <h2 className="mt-5 font-display text-3xl font-semibold break-words">{headline}</h2>
                <p className="mt-2 text-sm text-muted">{detail}</p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                    {canStartNew ? (
                        <button data-testid="overlay-new-game" onClick={onNewGame} className={btn.primary}>New game</button>
                    ) : (
                        <p className="text-sm text-muted self-center">Waiting for the players to start a new game</p>
                    )}
                    <button data-testid="overlay-review" onClick={onReview} className={btn.secondary}>Review board</button>
                </div>
            </div>
        </div>
    );
}

export function LobbyOverlay({ playerCount, role }: { playerCount: number, role: string }) {
    const isSpectator = role === 'SPECTATOR';
    const seat = (label: string, taken: boolean, you: boolean) => (
        <li className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3">
            <span className="text-sm font-medium">{label}</span>
            <span className={`text-sm ${taken ? 'text-success' : 'text-muted'}`}>{taken ? (you ? 'You' : 'Joined') : 'Waiting…'}</span>
        </li>
    );

    return (
        <div data-testid="lobby" className="fixed inset-0 z-[300] bg-canvas flex items-center justify-center p-4">
            <div className={`${dialog} max-w-md`}>
                <div className="w-12 h-12 rounded-2xl border border-line-strong bg-raised flex items-center justify-center">
                    <Users size={22} className="text-accent" />
                </div>
                <h2 className="mt-5 font-display text-2xl md:text-3xl font-semibold">
                    {isSpectator ? 'Both seats are taken' : 'Waiting for an opponent'}
                </h2>
                <p className="mt-2 text-sm text-muted">
                    {isSpectator
                        ? 'You are watching this room. The game appears here as soon as it starts.'
                        : 'Send a friend the room name and passcode. The game starts when they join.'}
                </p>
                <ul className="mt-6 space-y-2">
                    {seat('White', playerCount >= 1, !isSpectator)}
                    {seat('Black', playerCount >= 2, false)}
                </ul>
            </div>
        </div>
    );
}
