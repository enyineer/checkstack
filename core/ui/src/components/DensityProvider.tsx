import React, { useContext, useEffect, useState } from "react";
import { createRegisteredContext } from "../utils/registered-context";
import { cn } from "../utils";
import {
  DEFAULT_DENSITY,
  densityClassName,
  resolveDensity,
  toggleDensity,
  type Density,
} from "./DensityProvider.logic";

export type { Density } from "./DensityProvider.logic";

interface DensityProviderProps {
  children: React.ReactNode;
  /** Density used until a persisted preference is read. */
  defaultDensity?: Density;
  /** localStorage key the preference is persisted under (per-user). */
  storageKey?: string;
  /** Extra classes for the wrapper element that carries the density class. */
  className?: string;
}

interface DensityProviderState {
  density: Density;
  setDensity: (density: Density) => void;
  /** Flip between `comfortable` and `compact`. */
  toggleDensity: () => void;
}

const initialState: DensityProviderState = {
  density: DEFAULT_DENSITY,
  setDensity: () => {
    // Replaced by the provider.
  },
  toggleDensity: () => {
    // Replaced by the provider.
  },
};

// Registered (singleton) context: @checkstack/ui is bundled per consumer, but
// the host's provider and a plugin's useDensity() must share one context.
// Mirrors ThemeProvider / PerformanceProvider.
const DensityProviderContext = createRegisteredContext<DensityProviderState>(
  "checkstack.ui.density",
  initialState,
);

const STORAGE_KEY = "checkstack-ui-density";

/**
 * DensityProvider - sets the adaptive density class on a wrapper element and
 * exposes the per-user preference. The preference is persisted to
 * `localStorage` exactly like {@link ThemeProvider}'s theme.
 *
 * Unlike the theme (which toggles a class on `<html>`), density is scoped to
 * this wrapper so a sub-tree can opt into a different density if ever needed,
 * and so the `--d-*` token overrides cascade only to the wrapped content.
 */
export const DensityProvider: React.FC<DensityProviderProps> = ({
  children,
  defaultDensity = DEFAULT_DENSITY,
  storageKey = STORAGE_KEY,
  className,
}) => {
  const [density, setDensityState] = useState<Density>(() =>
    resolveDensity({
      value: globalThis.localStorage?.getItem(storageKey),
      fallback: defaultDensity,
    }),
  );

  // Re-resolve if the storageKey/default changes after mount (rare; keeps the
  // displayed density in sync with the active key).
  useEffect(() => {
    setDensityState((current) =>
      resolveDensity({
        value: globalThis.localStorage?.getItem(storageKey),
        fallback: current,
      }),
    );
  }, [storageKey]);

  const setDensity = (next: Density) => {
    globalThis.localStorage?.setItem(storageKey, next);
    setDensityState(next);
  };

  const value: DensityProviderState = {
    density,
    setDensity,
    toggleDensity: () => setDensity(toggleDensity(density)),
  };

  return (
    <DensityProviderContext.Provider value={value}>
      <div className={cn(densityClassName(density), className)}>{children}</div>
    </DensityProviderContext.Provider>
  );
};

/**
 * useDensity - read the current density and update the persisted preference.
 *
 * @example
 * const { density, setDensity, toggleDensity } = useDensity();
 */
export const useDensity = (): DensityProviderState =>
  useContext(DensityProviderContext);
