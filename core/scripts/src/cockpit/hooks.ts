import { useEffect, useReducer, useState } from "react";
import type { ProcessSnapshot, ProcessStore } from "./process-store.ts";

/**
 * Subscribe a component to a {@link ProcessStore}, re-rendering on every line /
 * status change and returning the latest snapshot. The store owns the data, so
 * this works across mount/unmount without losing or duplicating output.
 */
export function useProcessStore(store: ProcessStore): ProcessSnapshot {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(forceRender), [store]);
  return store.getSnapshot();
}

/** Advance a spinner frame on a fixed interval (for the shutdown overlay). */
export function useSpinnerFrame(intervalMs = 80): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setFrame((f) => f + 1), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);
  return frame;
}

