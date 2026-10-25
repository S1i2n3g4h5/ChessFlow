import { useEffect, useState } from 'react';
import { PlayerColor } from '../game/types';

type Clocks = Record<PlayerColor, number>;

/**
 * Smooth local countdown for the side to move, re-synced whenever `base` (the authoritative
 * clocks) changes. Only the clock display re-renders each second, not the board.
 */
export function useCountdown(base: Clocks, activeColor: PlayerColor, running: boolean): Clocks {
  const [display, setDisplay] = useState<Clocks>(base);
  const [syncedFrom, setSyncedFrom] = useState<Clocks>(base);
  if (base !== syncedFrom) {
    setSyncedFrom(base);
    setDisplay(base);
  }

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setDisplay(d => ({ ...d, [activeColor]: Math.max(0, d[activeColor] - 1) }));
    }, 1000);
    return () => clearInterval(id);
  }, [running, activeColor]);

  return display;
}
