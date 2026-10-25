"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Handshake, Undo2, Home, HelpCircle, Flag, RotateCcw, Scan, Eye } from 'lucide-react';
import { BoardSVG } from './BoardSVG';
import { PanZoomWrapper } from './PanZoomWrapper';
import { PlayerTag } from './PlayerTag';
import { PromotionOverlay, SetupOverlay, GameOverOverlay, LobbyOverlay } from './Overlays';
import { HowToPlayGuide, ReadyCard } from './HowToPlayGuide';
import { btn, panel } from './ui';
import { PlayerColor, PieceType } from '../game/types';
import { deriveCompleteState } from '../game/utils';
import { reconstructState } from '../game/playback';
import { canOfferDraw } from '../game/draw';
import { isGameStarted } from '../game/clock';
import { opponentOf } from '../game/utils';
import { hasSeenGuide, markGuideSeen } from '../lib/session';
import { GameController } from '../hooks/types';

// On desktop the board column (opponent tag + board + own tag) must fit under the header and inside the
// screen height, otherwise the vertically centred column is cut off on laptop screens.
const BOARD_COLUMN_WIDTH = 'w-full max-w-[760px] xl:max-w-[min(760px,calc(100vh-18.5rem))]';

const playbackButton = 'flex items-center justify-center w-11 h-11 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-accent';

interface Props {
    controller: GameController;
    /** Short label in the header, e.g. "Online · Arena Alpha" or "vs Computer · Medium". */
    headerLabel?: string;
    /** Back to the main menu. */
    onLeave?: () => void;
}

export function GameScreen({ controller, headerLabel, onLeave }: Props) {
    const { game, clocks, role, waitingForOpponent, needsName, dispatch, setName, startNewGame, syncError } = controller;

    const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
    const [pendingPromotion, setPendingPromotion] = useState<{ pieceId: string, toCellId: string } | null>(null);
    const [isViewLocked, setIsViewLocked] = useState<boolean>(false);
    const [viewingIndex, setViewingIndex] = useState<number | null>(null); // null = live, -1 = start position
    const [isReviewing, setIsReviewing] = useState<boolean>(false);
    const [confirmResign, setConfirmResign] = useState<boolean>(false);
    const [guideSeen, setGuideSeen] = useState<boolean>(() => hasSeenGuide());
    const [guideOpen, setGuideOpen] = useState<'ready' | 'reference' | null>(null);

    // A new game (different gameId) resets all per-game UI state
    const [seenGameId, setSeenGameId] = useState<string>(game.gameId);
    if (game.gameId !== seenGameId) {
        setSeenGameId(game.gameId);
        setViewingIndex(null);
        setSelectedPieceId(null);
        setPendingPromotion(null);
        setIsReviewing(false);
        setConfirmResign(false);
    }

    // Board state is only recomputed when the game itself changes, never on clock ticks
    const activeGame = useMemo(
        () => viewingIndex === null ? game : reconstructState(game.history, viewingIndex),
        [game, viewingIndex]
    );
    const completeState = useMemo(
        () => deriveCompleteState(activeGame, viewingIndex === null ? selectedPieceId : null),
        [activeGame, viewingIndex, selectedPieceId]
    );
    const onPromotionNeeded = useCallback((pieceId: string, toCellId: string) => setPendingPromotion({ pieceId, toCellId }), []);

    const handleResign = () => {
        if (role === 'SPECTATOR' || game.status !== 'ONGOING') return;
        if (!confirmResign) {
            setConfirmResign(true);
            setTimeout(() => setConfirmResign(false), 4000);
            return;
        }
        setConfirmResign(false);
        dispatch({ type: 'RESIGN', player: role });
    };

    const onPromotionChosen = (type: PieceType) => {
        if (!pendingPromotion) return;
        dispatch({ type: 'MOVE', pieceId: pendingPromotion.pieceId, toCellId: pendingPromotion.toCellId, promotionTo: type });
        setPendingPromotion(null);
        setSelectedPieceId(null);
    };

    // Move list playback
    const lastIndex = game.history.length - 1;
    const goToStart = () => { if (lastIndex >= 0) setViewingIndex(-1); };
    const goBack = () => {
        if (lastIndex < 0) return;
        setViewingIndex(v => v === null ? lastIndex - 1 : Math.max(-1, v - 1));
    };
    const goForward = () => setViewingIndex(v => (v === null || v + 1 >= lastIndex) ? null : v + 1);
    const goLive = () => setViewingIndex(null);

    const gameCanStart = isGameStarted(game, controller.playerCount);

    // Before the first move both players confirm they are ready (after the guide); the clock waits for that
    const readyGate = !waitingForOpponent && !needsName && game.status === 'ONGOING' && !(game.ready.WHITE && game.ready.BLACK);
    const myReady = role !== 'SPECTATOR' && game.ready[role];
    const getReady = () => {
        if (role === 'SPECTATOR') return;
        markGuideSeen();
        setGuideSeen(true);
        setGuideOpen(null);
        dispatch({ type: 'READY', player: role });
    };
    const bottomColor: PlayerColor = role === 'BLACK' ? 'BLACK' : 'WHITE';
    const topColor: PlayerColor = bottomColor === 'WHITE' ? 'BLACK' : 'WHITE';
    const tag = (color: PlayerColor, isUser: boolean) => (
        <PlayerTag
            color={color}
            name={game.names[color]}
            clock={clocks[color]}
            isUser={isUser}
            isTurn={game.status === 'ONGOING' && game.currentPlayer === color}
            untimed={!controller.clocksEnabled}
            thinking={controller.thinkingColor === color}
        />
    );

    return (
        <div className="min-h-screen xl:h-screen xl:overflow-hidden flex flex-col bg-canvas text-ink">
            {waitingForOpponent && <LobbyOverlay playerCount={controller.playerCount} role={role} />}

            {/* Header */}
            <header className="shrink-0 px-4 md:px-6 pt-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
                        <span className="font-display text-xl font-bold tracking-wide">CHESS<span className="text-accent">FLOW</span></span>
                        {headerLabel && (
                            <span data-testid="mode-label" className="text-xs font-medium text-muted rounded-full border border-line px-2.5 py-1">{headerLabel}</span>
                        )}
                        {role === 'SPECTATOR' && (
                            <span data-testid="spectator-badge" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent rounded-full border border-accent/40 px-2.5 py-1">
                                <Eye size={13} /> Watching
                            </span>
                        )}
                    </div>
                    <nav className="flex gap-2 shrink-0">
                        <button data-testid="cmd-help" onClick={() => setGuideOpen('reference')} className={btn.ghost} aria-label="How to play">
                            <HelpCircle size={16} /> <span className="hidden sm:inline">How to play</span>
                        </button>
                        {onLeave && (
                            <button data-testid="cmd-menu" onClick={onLeave} className={btn.secondary} aria-label="Menu">
                                <Home size={16} /> <span className="hidden sm:inline">Menu</span>
                            </button>
                        )}
                    </nav>
                </div>
            </header>

            <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-4 md:gap-6 p-4 md:p-6">
                {/* Board column */}
                <main className="flex-1 min-w-0 flex flex-col items-center gap-3 xl:overflow-y-auto xl:justify-center-safe">
                    <div className={BOARD_COLUMN_WIDTH} data-testid="player-tag-top">{tag(topColor, false)}</div>

                    <div data-testid="board-frame" className={`${BOARD_COLUMN_WIDTH} shrink-0 aspect-square relative rounded-2xl overflow-hidden border border-line bg-[#0b1222]`}>
                        <PanZoomWrapper disabled={isViewLocked}>
                            <BoardSVG
                                state={completeState}
                                onAction={dispatch}
                                onSelectPiece={setSelectedPieceId}
                                onPromotionNeeded={onPromotionNeeded}
                                perspective={bottomColor}
                                isLocked={isViewLocked}
                                interactive={viewingIndex === null && role !== 'SPECTATOR'}
                            />
                        </PanZoomWrapper>

                        {game.status !== 'ONGOING' && !isReviewing && (
                            <GameOverOverlay
                                status={game.status}
                                endReason={game.endReason}
                                names={game.names}
                                canStartNew={role !== 'SPECTATOR'}
                                onNewGame={startNewGame}
                                onReview={() => setIsReviewing(true)}
                            />
                        )}

                        {!waitingForOpponent && needsName && <SetupOverlay onSetName={setName} />}

                        {readyGate && role !== 'SPECTATOR' && guideOpen === null && (guideSeen || myReady) && (
                            <ReadyCard
                                waitingFor={myReady ? (game.names[opponentOf(role)] || 'your opponent') : null}
                                onReady={getReady}
                                onOpenGuide={() => setGuideOpen(myReady ? 'reference' : 'ready')}
                            />
                        )}
                        {readyGate && role === 'SPECTATOR' && (
                            <div data-testid="ready-spectator" className="absolute bottom-3 left-3 right-3 z-20 rounded-xl border border-line-strong bg-surface/95 px-4 py-3 text-sm text-muted text-center">
                                Waiting for both players to get ready
                            </div>
                        )}

                        {/* Pending draw offer, floating over the bottom of the board so the layout never shifts */}
                        {game.status === 'ONGOING' && game.drawOffer !== null && (
                            <div data-testid="draw-offer-banner" className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-surface/95 px-4 py-3 shadow-lg shadow-black/30">
                                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                                    <Handshake size={18} className="text-warn" />
                                    {role === game.drawOffer
                                        ? 'Draw offered - waiting for an answer'
                                        : `${game.names[game.drawOffer] || game.drawOffer} offers a draw`}
                                </span>
                                {role !== 'SPECTATOR' && role !== game.drawOffer && (
                                    <span className="flex gap-2">
                                        <button data-testid="draw-accept" onClick={() => dispatch({ type: 'RESPOND_DRAW', player: role, accept: true })} className={btn.primary}>
                                            Accept ½–½
                                        </button>
                                        <button data-testid="draw-decline" onClick={() => dispatch({ type: 'RESPOND_DRAW', player: role, accept: false })} className={btn.secondary}>
                                            Decline
                                        </button>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`${BOARD_COLUMN_WIDTH} relative`} data-testid="player-tag-bottom">{tag(bottomColor, role !== 'SPECTATOR')}</div>

                    {pendingPromotion && <PromotionOverlay color={role as PlayerColor} onSelect={onPromotionChosen} />}
                </main>

                {/* Sidebar */}
                <aside className="w-full xl:w-[360px] shrink-0 flex flex-col gap-4 xl:min-h-0">
                    <section className={`${panel} flex-1 min-h-[18rem] xl:min-h-0 flex flex-col overflow-hidden`} aria-label="Moves">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                            <h2 className="font-display text-base font-semibold">Moves</h2>
                            {viewingIndex !== null ? (
                                <button data-testid="back-to-live" onClick={goLive} className="text-sm font-medium text-accent hover:text-accent-hover">
                                    Back to live
                                </button>
                            ) : (
                                <span className="text-xs text-muted">{game.history.length} half-moves</span>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-3">
                            <div data-testid="move-list" className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-1.5 gap-y-1 items-center">
                                {Array.from({ length: Math.ceil(game.notation.length / 2) }).map((_, turnIdx) => {
                                    const whiteIdx = turnIdx * 2;
                                    const blackIdx = turnIdx * 2 + 1;
                                    const moveButton = (idx: number) => (
                                        <button
                                            data-testid="move-item"
                                            data-active={viewingIndex === idx}
                                            onClick={() => setViewingIndex(idx)}
                                            className={`text-left px-2.5 py-1.5 rounded-lg font-mono text-sm transition-colors ${viewingIndex === idx ? 'bg-accent text-on-accent' : 'text-ink hover:bg-raised'}`}
                                        >
                                            {game.notation[idx]}
                                        </button>
                                    );
                                    return (
                                        <React.Fragment key={turnIdx}>
                                            <div className="text-xs text-muted text-center tabular-nums">{turnIdx + 1}</div>
                                            {moveButton(whiteIdx)}
                                            {blackIdx < game.notation.length ? moveButton(blackIdx) : <div />}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                            {game.history.length === 0 && (
                                <p className="h-full min-h-24 flex items-center justify-center text-sm text-muted">No moves yet</p>
                            )}
                        </div>

                        <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-t border-line">
                            <button data-testid="playback-start" onClick={goToStart} title="Start position" aria-label="Start position" className={playbackButton}><ChevronsLeft size={18} /></button>
                            <button data-testid="playback-prev" onClick={goBack} title="Previous move" aria-label="Previous move" className={playbackButton}><ChevronLeft size={18} /></button>
                            <button data-testid="playback-next" onClick={goForward} title="Next move" aria-label="Next move" className={playbackButton}><ChevronRight size={18} /></button>
                            <button data-testid="playback-live" onClick={goLive} title="Live position" aria-label="Live position" className={playbackButton}><ChevronsRight size={18} /></button>
                        </div>
                    </section>

                    <section className={`${panel} px-4 py-3 space-y-2 text-sm text-muted`} aria-label="Board key">
                        <div className="flex items-center gap-3"><span className="w-4 h-4 rounded border border-accent/70 bg-accent/10"></span>Cells you can add</div>
                        <div className="flex items-center gap-3"><span className="w-4 h-4 rounded bg-warn/60"></span>New cell, still settling</div>
                        <div className="flex items-center gap-3"><span className="w-4 h-4 rounded bg-danger/60"></span>King in check</div>
                    </section>

                    <section className="flex flex-col gap-2" aria-label="Game actions">
                        {controller.undo && (
                            <button data-testid="cmd-undo" disabled={!controller.canUndo} onClick={controller.undo} className={`${btn.secondary} w-full`}>
                                <Undo2 size={16} /> Undo last move
                            </button>
                        )}
                        {game.status === 'ONGOING' ? (
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    data-testid="cmd-offer-draw"
                                    disabled={role === 'SPECTATOR' || !canOfferDraw(game, role) || !gameCanStart}
                                    onClick={() => role !== 'SPECTATOR' && dispatch({ type: 'OFFER_DRAW', player: role })}
                                    title={role !== 'SPECTATOR' && game.drawOffer === null && !canOfferDraw(game, role) ? 'You can offer again after your next move' : undefined}
                                    className={btn.secondary}
                                >
                                    <Handshake size={16} />
                                    {game.drawOffer !== null && game.drawOffer === role ? 'Draw offered…' : 'Offer draw'}
                                </button>
                                <button
                                    data-testid="cmd-resign"
                                    disabled={role === 'SPECTATOR'}
                                    onClick={handleResign}
                                    className={confirmResign ? `${btn.danger} bg-danger/15` : btn.danger}
                                >
                                    {confirmResign ? 'Click again to resign' : <><Flag size={16} />Resign</>}
                                </button>
                            </div>
                        ) : (
                            <button data-testid="cmd-new-game" disabled={role === 'SPECTATOR'} onClick={startNewGame} className={`${btn.primary} w-full`}>
                                <RotateCcw size={16} /> New game
                            </button>
                        )}
                        <button
                            data-testid="cmd-view-lock"
                            aria-pressed={isViewLocked}
                            onClick={() => setIsViewLocked(!isViewLocked)}
                            className={`${btn.ghost} w-full`}
                        >
                            <Scan size={16} /> {isViewLocked ? 'Show whole grid' : 'Fit view to board'}
                        </button>
                    </section>
                </aside>
            </div>

            {/* Full guide: automatically before your first game on this browser, or on request */}
            {((readyGate && role !== 'SPECTATOR' && !myReady && !guideSeen) || guideOpen !== null) && (
                <HowToPlayGuide
                    mode={guideOpen === 'reference' || myReady || !readyGate ? 'reference' : 'ready'}
                    onReady={getReady}
                    onClose={() => setGuideOpen(null)}
                    clockWarning={gameCanStart && game.status === 'ONGOING'}
                />
            )}

            {syncError && (
                <div data-testid="sync-error" role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] rounded-xl border border-danger/40 bg-surface px-4 py-2.5 text-sm font-medium text-danger shadow-lg shadow-black/30">
                    {syncError}
                </div>
            )}
            {controller.notice && (
                <div data-testid="notice" role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-[1000] rounded-xl border border-accent/40 bg-surface px-4 py-2.5 text-sm font-medium text-ink shadow-lg shadow-black/30">
                    {controller.notice}
                </div>
            )}
        </div>
    );
}
