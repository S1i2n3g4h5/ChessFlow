import React, { useState } from 'react';
import { Feather, Swords, Brain, Shuffle, ArrowLeft } from 'lucide-react';
import { PieceSVG } from './PieceSVG';
import { btn, optionCard, pageTitle, sectionLabel } from './ui';
import { BOT_LEVELS, BotLevel } from '../game/ai/bot';
import { PlayerColor } from '../game/types';
import { ComputerSettings } from '../lib/computerStorage';

type ColorChoice = PlayerColor | 'RANDOM';

const LEVEL_ICONS: Record<BotLevel, React.ReactNode> = {
    EASY: <Feather size={20} />,
    MEDIUM: <Swords size={20} />,
    HARD: <Brain size={20} />,
};

const TIME_OPTIONS: { value: number | null, label: string, hint: string }[] = [
    { value: null, label: 'Untimed', hint: 'No clock' },
    { value: 600, label: '10 min', hint: 'per side' },
    { value: 1800, label: '30 min', hint: 'per side' },
];

interface Props {
    initial: ComputerSettings;
    onStart: (settings: ComputerSettings) => void;
    onBack: () => void;
}

/** Difficulty, color and time control for a game against the computer. */
export function ComputerSetup({ initial, onStart, onBack }: Props) {
    const [level, setLevel] = useState<BotLevel>(initial.level);
    const [color, setColor] = useState<ColorChoice>(initial.humanColor);
    const [timeControl, setTimeControl] = useState<number | null>(initial.timeControl);

    const start = () => {
        const humanColor: PlayerColor = color === 'RANDOM' ? (Math.random() < 0.5 ? 'WHITE' : 'BLACK') : color;
        onStart({ level, humanColor, timeControl });
    };

    return (
        <div data-testid="computer-setup" className="fixed inset-0 z-[500] bg-canvas overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-16">
                <button data-testid="setup-back" onClick={onBack} className={`${btn.ghost} -ml-3`}>
                    <ArrowLeft size={16} /> Menu
                </button>

                <h1 className={`${pageTitle} mt-6`}>Play vs computer</h1>
                <p className="mt-2 text-muted">Runs entirely in your browser. Your game is saved here, so you can come back to it.</p>

                <section className="mt-10" aria-labelledby="level-label">
                    <h2 id="level-label" className={sectionLabel}>Difficulty</h2>
                    <div className="mt-3 grid md:grid-cols-3 gap-3">
                        {(Object.keys(BOT_LEVELS) as BotLevel[]).map(l => (
                            <button key={l} data-testid={`level-${l}`} aria-pressed={level === l} onClick={() => setLevel(l)} className={optionCard(level === l)}>
                                <span className={level === l ? 'text-accent' : 'text-muted'}>{LEVEL_ICONS[l]}</span>
                                <span className="mt-3 block font-display text-xl font-semibold text-ink">{BOT_LEVELS[l].label}</span>
                                <span className="mt-1 block text-sm text-muted leading-relaxed">{BOT_LEVELS[l].description}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="mt-8" aria-labelledby="color-label">
                    <h2 id="color-label" className={sectionLabel}>Play as</h2>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                        {(['WHITE', 'RANDOM', 'BLACK'] as ColorChoice[]).map(c => (
                            <button key={c} data-testid={`color-${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`${optionCard(color === c)} flex flex-col items-center gap-2 text-center`}>
                                <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${c === 'WHITE' ? 'bg-[#dbe4f0]' : c === 'BLACK' ? 'bg-raised border border-line-strong' : 'bg-raised border border-line-strong text-muted'}`}>
                                    {c === 'RANDOM' ? <Shuffle size={18} /> : <PieceSVG type="KING" color={c} size="70%" />}
                                </span>
                                <span className="text-sm font-semibold text-ink">{c === 'RANDOM' ? 'Random' : c === 'WHITE' ? 'White' : 'Black'}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="mt-8" aria-labelledby="clock-label">
                    <h2 id="clock-label" className={sectionLabel}>Clock</h2>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                        {TIME_OPTIONS.map(opt => (
                            <button key={opt.label} data-testid={`time-${opt.value ?? 'untimed'}`} aria-pressed={timeControl === opt.value} onClick={() => setTimeControl(opt.value)} className={`${optionCard(timeControl === opt.value)} text-center`}>
                                <span className="block font-display text-lg font-semibold text-ink">{opt.label}</span>
                                <span className="block text-xs text-muted">{opt.hint}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <button data-testid="start-computer" onClick={start} className={`${btn.primary} mt-10 w-full min-h-12 text-base`}>
                    Start game
                </button>
            </div>
        </div>
    );
}
