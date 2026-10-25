"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, X, BookOpen } from 'lucide-react';
import { BoardSVG } from './BoardSVG';
import { btn } from './ui';
import { GUIDE_STEPS } from '../game/guide';
import { GameState, TurnAction } from '../game/types';
import { deriveCompleteState } from '../game/utils';
import { gameReducer } from '../game/reducer';

interface Props {
    /** 'ready': shown before a game, ends with "I'm ready". 'reference': opened from a How to play button. */
    mode: 'ready' | 'reference';
    onReady?: () => void;
    onClose?: () => void;
    /** Shown in reference mode during a live game. */
    clockWarning?: boolean;
}

/** Interactive How-to-Play guide: every step has a mini board driven by the real rules engine. */
export function HowToPlayGuide({ mode, onReady, onClose, clockWarning }: Props) {
    const [index, setIndex] = useState(0);
    const step = GUIDE_STEPS[index];
    const [scenario, setScenario] = useState<GameState>(() => step.scenario());
    const [selected, setSelected] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const last = index === GUIDE_STEPS.length - 1;

    const goTo = useCallback((i: number) => {
        const next = Math.max(0, Math.min(GUIDE_STEPS.length - 1, i));
        setIndex(next);
        setScenario(GUIDE_STEPS[next].scenario());
        setSelected(null);
        setDone(false);
    }, []);

    const reset = () => goTo(index);

    // Keyboard: arrows to navigate, Escape to close the reference guide
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') goTo(index + 1);
            else if (e.key === 'ArrowLeft') goTo(index - 1);
            else if (e.key === 'Escape' && mode === 'reference') onClose?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index, goTo, mode, onClose]);

    const play = useCallback((action: TurnAction) => {
        const next = gameReducer(scenario, action);
        if (next === scenario) return;
        setScenario(next);
        setSelected(null);
        if (step.goal?.(scenario, action, next)) setDone(true);
    }, [scenario, step]);

    const onPromotionNeeded = useCallback((pieceId: string, toCellId: string) => {
        play({ type: 'MOVE', pieceId, toCellId, promotionTo: 'QUEEN' });
    }, [play]);

    const complete = useMemo(() => deriveCompleteState(scenario, selected), [scenario, selected]);
    const interactive = scenario.status === 'ONGOING' && scenario.currentPlayer === 'WHITE' && !done;

    return (
        <div data-testid="guide" role="dialog" aria-label="How to play ChessFlow" className="fixed inset-0 z-[600] bg-canvas/95 overflow-y-auto">
            <div className="min-h-full flex items-center justify-center p-4 md:p-8">
                <div className="w-full max-w-5xl rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-4 px-5 md:px-6 py-3 border-b border-line">
                        <div className="flex items-center gap-2 text-sm font-medium text-muted">
                            <BookOpen size={16} className="text-accent" /> How to play
                        </div>
                        {mode === 'reference' ? (
                            <button data-testid="guide-close" onClick={onClose} className={btn.ghost} aria-label="Close guide">
                                <X size={18} />
                            </button>
                        ) : !last && (
                            <button data-testid="guide-skip" onClick={() => goTo(GUIDE_STEPS.length - 1)} className={btn.ghost}>
                                Skip guide
                            </button>
                        )}
                    </div>

                    <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 md:gap-8 p-5 md:p-8">
                        {/* Mini board */}
                        <div className="space-y-3">
                            <div data-testid="guide-board" className="relative aspect-square w-full max-w-[440px] mx-auto rounded-xl overflow-hidden border border-line bg-[#0b1222]">
                                <BoardSVG
                                    state={complete}
                                    onAction={play}
                                    onSelectPiece={setSelected}
                                    onPromotionNeeded={onPromotionNeeded}
                                    perspective="WHITE"
                                    isLocked
                                    interactive={interactive}
                                />
                            </div>
                            {step.task && (
                                <div className="flex justify-center">
                                    <button data-testid="guide-reset" onClick={reset} className={btn.ghost}>
                                        <RotateCcw size={14} /> Try again
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Text */}
                        <div className="flex flex-col">
                            <span data-testid="guide-progress" className="text-xs font-medium text-muted">Step {index + 1} of {GUIDE_STEPS.length}</span>
                            <h2 data-testid="guide-title" className="mt-1 font-display text-2xl md:text-3xl font-semibold text-ink">{step.title}</h2>
                            <div className="mt-4 space-y-3 text-[15px] text-muted leading-relaxed">
                                {step.body.map((p, i) => <p key={i}>{p}</p>)}
                            </div>

                            {step.task && (
                                <div data-testid="guide-task" data-done={done} className={`mt-6 rounded-xl border px-4 py-3 ${done ? 'border-success/50 bg-success/10' : 'border-accent/40 bg-accent/5'}`}>
                                    {done ? (
                                        <p className="flex items-start gap-2 text-sm font-medium text-ink">
                                            <CheckCircle2 size={18} className="shrink-0 mt-0.5 text-success" /> {step.success}
                                        </p>
                                    ) : (
                                        <p className="text-sm text-ink">
                                            <span className="block text-xs font-semibold text-accent mb-1">Try it</span>
                                            {step.task}
                                        </p>
                                    )}
                                </div>
                            )}

                            {last && mode === 'reference' && clockWarning && (
                                <p className="mt-4 text-sm text-warn">Your game clock keeps running while this guide is open.</p>
                            )}

                            <div className="mt-auto pt-8 space-y-4">
                                {/* Progress */}
                                <div className="flex gap-1.5 flex-wrap" aria-label="Guide steps">
                                    {GUIDE_STEPS.map((s, i) => (
                                        <button
                                            key={s.id}
                                            onClick={() => goTo(i)}
                                            aria-label={`Step ${i + 1}: ${s.title}`}
                                            aria-current={i === index ? 'step' : undefined}
                                            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-accent' : i < index ? 'w-4 bg-accent/40' : 'w-4 bg-line-strong hover:bg-muted'}`}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <button data-testid="guide-back" onClick={() => goTo(index - 1)} disabled={index === 0} className={btn.secondary}>
                                        <ChevronLeft size={16} /> Back
                                    </button>
                                    {!last ? (
                                        <button
                                            data-testid="guide-next"
                                            onClick={() => goTo(index + 1)}
                                            className={!step.task || done ? btn.primary : btn.secondary}
                                        >
                                            {step.task && !done ? 'Skip step' : 'Next'} <ChevronRight size={16} />
                                        </button>
                                    ) : mode === 'ready' ? (
                                        <button data-testid="guide-ready" onClick={onReady} className={btn.primary}>
                                            I&apos;m ready
                                        </button>
                                    ) : (
                                        <button data-testid="guide-done" onClick={onClose} className={btn.primary}>
                                            Done
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Compact "get ready" card for players who have already seen the full guide, and the waiting state. */
export function ReadyCard({ waitingFor, onReady, onOpenGuide }: { waitingFor: string | null, onReady?: () => void, onOpenGuide: () => void }) {
    return (
        <div data-testid="ready-card" className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/80 p-4">
            <div className="max-w-sm w-full rounded-2xl border border-line bg-surface p-6 text-center shadow-2xl shadow-black/40">
                {waitingFor ? (
                    <>
                        <div className="mx-auto w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" aria-hidden="true" />
                        <p data-testid="ready-waiting" className="mt-4 font-display text-lg font-semibold text-ink">Waiting for {waitingFor} to get ready…</p>
                        <p className="mt-1 text-sm text-muted">The clock starts as soon as both players are ready.</p>
                    </>
                ) : (
                    <>
                        <h3 className="font-display text-2xl font-semibold text-ink">Ready?</h3>
                        <p className="mt-2 text-sm text-muted">Each turn: move a piece or add a cell to the edge. New cells settle for a turn. No expanding next to a king or while in check.</p>
                        <button data-testid="ready-button" onClick={onReady} className={`${btn.primary} mt-5 w-full`}>
                            I&apos;m ready
                        </button>
                    </>
                )}
                <button data-testid="ready-open-guide" onClick={onOpenGuide} className={`${btn.ghost} mt-2 w-full`}>
                    View the full guide
                </button>
            </div>
        </div>
    );
}
