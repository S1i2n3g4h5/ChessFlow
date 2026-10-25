import React from 'react';
import { Users, Cpu, Play, BookOpen, ChevronRight } from 'lucide-react';

interface Props {
    onOnline: () => void;
    onComputer: () => void;
    onHowToPlay: () => void;
    /** Shown when a computer game is saved in this browser. */
    onResume?: () => void;
    resumeLabel?: string;
    notice?: string | null;
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const row = `w-full flex items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-left transition-colors ${focus}`;
const card = `group flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 text-left transition-colors hover:border-line-strong hover:bg-raised ${focus}`;

export function HomeMenu({ onOnline, onComputer, onHowToPlay, onResume, resumeLabel, notice }: Props) {
    return (
        <div data-testid="home-menu" className="fixed inset-0 z-[500] bg-canvas overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 md:px-6 py-12 md:py-20">
                <header className="space-y-3">
                    <h1 className="font-display text-5xl md:text-6xl font-bold tracking-wide">CHESS<span className="text-accent">FLOW</span></h1>
                    <p className="text-muted text-base md:text-lg max-w-xl">
                        Chess on a board that grows. Every turn, move a piece or add one new cell to the edge of the board.
                    </p>
                </header>

                {notice && (
                    <div data-testid="menu-notice" role="status" className="mt-8 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">
                        {notice}
                    </div>
                )}

                {onResume && (
                    <button data-testid="menu-resume" onClick={onResume} className={`${row} mt-8 border-accent/50 bg-accent/10 hover:bg-accent/15`}>
                        <span className="flex items-center gap-4">
                            <Play size={20} className="text-accent" />
                            <span>
                                <span className="block font-semibold text-ink">Resume game</span>
                                <span className="block text-sm text-muted">{resumeLabel}</span>
                            </span>
                        </span>
                        <ChevronRight size={18} className="text-accent" />
                    </button>
                )}

                <div className="mt-8 grid md:grid-cols-2 gap-4">
                    <button data-testid="menu-online" onClick={onOnline} className={card}>
                        <span className="w-11 h-11 rounded-xl border border-line-strong bg-raised flex items-center justify-center">
                            <Users size={20} className="text-accent" />
                        </span>
                        <span>
                            <span className="block font-display text-2xl font-semibold text-ink">Play online</span>
                            <span className="mt-1 block text-sm text-muted">Two passcode rooms, up to 4 players at once, plus spectators.</span>
                        </span>
                    </button>
                    <button data-testid="menu-computer" onClick={onComputer} className={card}>
                        <span className="w-11 h-11 rounded-xl border border-line-strong bg-raised flex items-center justify-center">
                            <Cpu size={20} className="text-accent" />
                        </span>
                        <span>
                            <span className="block font-display text-2xl font-semibold text-ink">Play vs computer</span>
                            <span className="mt-1 block text-sm text-muted">Easy, Medium or Hard. Runs in your browser, no second player needed.</span>
                        </span>
                    </button>
                </div>

                <button data-testid="menu-guide" onClick={onHowToPlay} className={`${row} mt-4 border-line bg-surface hover:border-line-strong hover:bg-raised`}>
                    <span className="flex items-center gap-4">
                        <BookOpen size={20} className="text-accent" />
                        <span>
                            <span className="block font-semibold text-ink">How to play</span>
                            <span className="block text-sm text-muted">A two-minute interactive tour of the rules, with mini boards to try them on.</span>
                        </span>
                    </span>
                    <ChevronRight size={18} className="text-muted" />
                </button>

                <p className="mt-12 text-xs text-muted">ChessFlow v3.0</p>
            </div>
        </div>
    );
}
