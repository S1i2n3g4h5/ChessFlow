"use client";

import React, { memo } from 'react';
import { CompleteState, TurnAction } from '../game/types';
import { motion, AnimatePresence } from 'framer-motion';
import { PieceSVG } from './PieceSVG';
import { isInCheck, isPromotionMove } from '../game/engine';
import { computeViewBox, getCellId, GRID_SIZE } from '../game/utils';
import { fileLabel, rankLabel } from '../game/notation';

// Board palette (Neon Arena): steel-blue squares on a dark navy void, cyan for "you can act here"
const LIGHT = '#dbe4f0';
const DARK = '#6c86ab';
const VOID = '#0b1222';

interface Props {
  state: CompleteState;
  onAction: (action: TurnAction) => void;
  onSelectPiece: (id: string | null) => void;
  onPromotionNeeded: (pieceId: string, toCellId: string) => void;
  perspective?: 'WHITE' | 'BLACK' | 'SPECTATOR';
  isLocked?: boolean;
  interactive?: boolean;
}

function BoardSVGInner({ state, onAction, onSelectPiece, onPromotionNeeded, perspective = 'WHITE', isLocked = false, interactive = true }: Props) {
  const { game, view } = state;
  const isFlipped = perspective === 'BLACK';

  const cells = Object.values(game.board);

  // Locked view frames the active area (+2 cells); free view shows the whole 16x16 grid
  const vb = computeViewBox(game, isFlipped, isLocked);
  const currentViewBox = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;

  // Screen <-> grid mapping (the board is rotated 180 degrees for Black)
  const toFile = (sx: number) => isFlipped ? GRID_SIZE - 1 - sx : sx;
  const toRank = (sy: number) => isFlipped ? sy : GRID_SIZE - 1 - sy;
  const labelColor = (file: number, rank: number) => {
    const cell = game.board[getCellId(file, rank)];
    if (!cell?.active) return 'rgba(148, 163, 184, 0.5)';
    return (file + rank) % 2 !== 0 ? DARK : LIGHT;
  };

  const checkedKing = game.status === 'ONGOING' && isInCheck(game, game.currentPlayer)
    ? Object.values(game.pieces).find(p => p.type === 'KING' && p.owner === game.currentPlayer)
    : undefined;

  const handleCellClick = (file: number, rank: number) => {
    const cellId = `${file},${rank}`;

    // Only allow interaction if it matches your role
    const isMyTurn = game.currentPlayer === perspective;
    const isSpectator = perspective === 'SPECTATOR';
    if (!interactive || isSpectator) return;

    const pieceAt = Object.values(game.pieces).find(p => p.cellId === cellId);

    // 1. Move Execution (Highest Priority)
    if (view.selectedPieceId && view.legalMoves.includes(cellId)) {
      if (isMyTurn) {
        if (isPromotionMove(game, view.selectedPieceId, cellId)) {
          onPromotionNeeded(view.selectedPieceId, cellId);
          return;
        }
        onAction({ type: 'MOVE', pieceId: view.selectedPieceId, toCellId: cellId });
        onSelectPiece(null);
        return;
      }
    }

    // 2. Expansion Execution
    if (view.legalExpansionTargets.includes(cellId)) {
      if (isMyTurn) {
        onAction({ type: 'EXPAND', cellId });
        return;
      }
    }

    // 3. Selection / Piece Focus
    if (pieceAt) {
      onSelectPiece(pieceAt.id);
    } else {
      onSelectPiece(null);
    }
  };

  return (
    <svg
      data-testid="board-svg"
      viewBox={currentViewBox}
      className="w-full h-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* 1. Layers: Base Cells */}
      {cells.map((cell) => {
        const isLight = (cell.file + cell.rank) % 2 !== 0;
        const color = cell.active ? (isLight ? LIGHT : DARK) : VOID;

        const x = isFlipped ? 15 - cell.file : cell.file;
        const y = isFlipped ? cell.rank : 15 - cell.rank;

        return (
          <rect
            key={cell.id}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={color}
            stroke={cell.active ? 'none' : 'rgba(148,163,184,0.07)'}
            strokeWidth={0.02}
            onClick={() => handleCellClick(cell.file, cell.rank)}
          />
        );
      })}

      {/* 2. Highlight: last move */}
      {game.lastMove && (() => {
        const [f1, r1] = game.lastMove.from.split(',').map(Number);
        const [f2, r2] = game.lastMove.to.split(',').map(Number);
        const x1 = isFlipped ? 15 - f1 : f1;
        const y1 = isFlipped ? r1 : 15 - r1;
        const x2 = isFlipped ? 15 - f2 : f2;
        const y2 = isFlipped ? r2 : 15 - r2;
        return (
          <g pointerEvents="none">
            <rect x={x1} y={y1} width={1} height={1} fill="rgba(34, 211, 238, 0.18)" />
            <rect x={x2} y={y2} width={1} height={1} fill="rgba(34, 211, 238, 0.3)" />
          </g>
        );
      })()}

      {/* 2b. Highlight: Last Expansion */}
      {game.lastExpansion && (() => {
        const [f, r] = game.lastExpansion.split(',').map(Number);
        const x = isFlipped ? 15 - f : f;
        const y = isFlipped ? r : 15 - r;
        return (
          <motion.rect
            key={`last-exp-${game.lastExpansion}`}
            x={x + 0.03} y={y + 0.03} width={0.94} height={0.94}
            fill="none"
            stroke="rgb(34, 211, 238)"
            strokeWidth={0.06}
            pointerEvents="none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          />
        );
      })()}

      {/* 2. Highlight: Selected & Moves */}
      {view.legalMoves.map(id => {
        const [f, r] = id.split(',').map(Number);
        const x = isFlipped ? 15 - f : f;
        const y = isFlipped ? r : 15 - r;
        return (
          <circle
            key={`move-${id}`}
            cx={x + 0.5} cy={y + 0.5} r={0.14}
            fill="rgba(7, 11, 20, 0.35)"
            pointerEvents="none"
          />
        );
      })}

      {/* 3. Cells that can be added this turn */}
      {(perspective === 'WHITE' || perspective === 'BLACK') && view.legalExpansionTargets.map(id => {
        const [f, r] = id.split(',').map(Number);
        const x = isFlipped ? 15 - f : f;
        const y = isFlipped ? r : 15 - r;
        const canPlace = interactive && game.currentPlayer === perspective;

        return (
          <rect
            key={`ghost-${id}`}
            data-kind="expansion-target"
            x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08}
            fill="rgba(34, 211, 238, 0.06)"
            stroke="rgba(34, 211, 238, 0.35)"
            strokeWidth={0.03}
            className={`${canPlace ? 'cursor-pointer hover:fill-cyan-400/30 hover:stroke-cyan-300' : 'cursor-default'} transition-colors`}
            onClick={(e) => {
              if (!canPlace) return;
              e.stopPropagation();
              handleCellClick(f, r);
            }}
          />
        );
      })}

      {/* 4. Stabilizing cells (just added; the opponent can't use them yet) */}
      {cells.filter(c => c.stabilizingUntil).map(c => {
        const x = isFlipped ? 15 - c.file : c.file;
        const y = isFlipped ? c.rank : 15 - c.rank;
        return (
          <rect
            key={`stab-${c.id}`}
            x={x} y={y} width={1} height={1}
            data-kind="stabilizing"
            fill="rgba(245, 158, 11, 0.5)"
            pointerEvents="none"
          />
        );
      })}

      {/* 4b. Check Warning */}
      {checkedKing && (() => {
        const [f, r] = checkedKing.cellId.split(',').map(Number);
        const x = isFlipped ? 15 - f : f;
        const y = isFlipped ? r : 15 - r;
        return (
          <rect
            key={`check-${checkedKing.cellId}`}
            data-kind="check"
            x={x} y={y} width={1} height={1}
            fill="rgba(248, 113, 113, 0.6)"
            stroke="rgb(239, 68, 68)"
            strokeWidth={0.05}
            pointerEvents="none"
          />
        );
      })()}

      {/* 4c. Coordinates: files a-p centred on the bottom edge, ranks 1-16 mid-height on the left edge (clear of the rounded frame corners) */}
      <g pointerEvents="none" className="select-none" fontSize={0.22} fontWeight={600} fontFamily="var(--font-inter), ui-sans-serif, system-ui, sans-serif">
        {Array.from({ length: vb.width }, (_, i) => {
          const sx = vb.x + i;
          const sy = vb.y + vb.height - 1;
          return (
            <text key={`file-${sx}`} x={sx + 0.5} y={sy + 0.88} textAnchor="middle" fill={labelColor(toFile(sx), toRank(sy))}>
              {fileLabel(toFile(sx))}
            </text>
          );
        })}
        {Array.from({ length: vb.height }, (_, i) => {
          const sy = vb.y + i;
          return (
            <text key={`rank-${sy}`} x={vb.x + 0.08} y={sy + 0.58} fill={labelColor(toFile(vb.x), toRank(sy))}>
              {rankLabel(toRank(sy))}
            </text>
          );
        })}
      </g>

      {/* 5. Pieces Layer */}
      <AnimatePresence>
        {Object.values(game.pieces).map((piece) => {
          const [f, r] = piece.cellId.split(',').map(Number);
          const x = isFlipped ? 15 - f : f;
          const y = isFlipped ? r : 15 - r;
          const isSelected = view.selectedPieceId === piece.id;

          return (
            <motion.g
              key={piece.id}
              initial={false}
              animate={{ x, y }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              style={{ pointerEvents: 'none' }}
            >
              {isSelected && (
                <rect x={0} y={0} width={1} height={1} fill="rgba(34, 211, 238, 0.4)" />
              )}

              <PieceSVG
                type={piece.type}
                color={piece.owner}
                size="0.8"
                className="select-none"
                style={{
                  transform: 'translate(10%, 10%)',
                }}
              />
            </motion.g>
          );
        })}
      </AnimatePresence>
    </svg>
  );
}

/** Memoised: the board only re-renders when the position, selection or view changes (not on clock ticks). */
export const BoardSVG = memo(BoardSVGInner);
