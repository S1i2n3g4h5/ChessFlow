"use client";

import React, { ReactNode } from 'react';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  children: ReactNode;
  disabled?: boolean;
}

const zoomButton = 'flex items-center justify-center w-10 h-10 rounded-lg border border-line bg-surface/90 text-muted hover:text-ink hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-accent';

export function PanZoomWrapper({ children, disabled = false }: Props) {
  // Fills the square board frame exactly, so the board is never larger than its container (no edge cut-off)
  return (
    <div className="absolute inset-0 overflow-hidden group">
      <TransformWrapper
        initialScale={1}
        minScale={1}
        maxScale={8}
        centerOnInit={true}
        limitToBounds={false}
        disabled={disabled}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <TransformResetter disabled={disabled} reset={resetTransform}>
            {/* Zoom controls: faint until the board is hovered or a control is focused (always usable on touch) */}
            <div className={`absolute top-3 right-3 z-10 flex flex-col gap-1.5 transition-opacity ${disabled ? 'opacity-0 pointer-events-none' : 'opacity-60 group-hover:opacity-100 focus-within:opacity-100'}`}>
              <button onClick={() => zoomIn()} className={zoomButton} aria-label="Zoom in"><ZoomIn size={18} /></button>
              <button onClick={() => zoomOut()} className={zoomButton} aria-label="Zoom out"><ZoomOut size={18} /></button>
              <button onClick={() => resetTransform()} className={zoomButton} aria-label="Reset zoom"><Maximize2 size={18} /></button>
            </div>

            <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: "100%", height: "100%", display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div className="w-full h-full flex items-center justify-center">
                {children}
              </div>
            </TransformComponent>
          </TransformResetter>
        )}
      </TransformWrapper>
    </div>
  );
}

function TransformResetter({ children, disabled, reset }: { children: React.ReactNode, disabled: boolean, reset: () => void }) {
  React.useEffect(() => {
    if (disabled) {
      reset();
    }
  }, [disabled, reset]);

  return <>{children}</>;
}
