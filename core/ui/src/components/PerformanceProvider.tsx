import React, { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "checkstack-low-power";

interface PerformanceContextValue {
  /** 
   * Whether the application should run in low-power mode.
   * Derived from (manualLowPower || prefersReducedMotion).
   */
  isLowPower: boolean;
  /** Whether the performance state has been initialized from storage */
  isLoaded: boolean;
  /** The current state of the manual toggle */
  manualLowPower: boolean;
  /** Toggle the manual low power setting */
  toggleManualLowPower: () => void;
}

const PerformanceContext = createContext<PerformanceContextValue>({
  isLowPower: false,
  isLoaded: false,
  manualLowPower: false,
  toggleManualLowPower: () => {},
});

/**
 * usePerformance - Hook to access the global hardware performance state.
 * Use this to conditionally disable heavy visual effects.
 */
export const usePerformance = () => useContext(PerformanceContext);

interface PerformanceProviderProps {
  children: React.ReactNode;
}

/**
 * PerformanceProvider - Centralizes management of the application's performance tier.
 * Supports manual override (persisted to localStorage) and respects OS-level
 * Reduced Motion preferences.
 */
export const PerformanceProvider: React.FC<PerformanceProviderProps> = ({ children }) => {
  const [manualLowPower, setManualLowPower] = useState<boolean>(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    // 1. Initialize Manual Toggle from localStorage
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "true") {
      setManualLowPower(true);
    }

    // 2. Initialize Reduced Motion Detection
    const mediaQuery = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    // 3. Listen for changes in OS-level settings
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", listener);

    setIsLoaded(true);

    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  const toggleManualLowPower = () => {
    setManualLowPower((prev) => {
      const next = !prev;
      globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const isLowPower = manualLowPower || prefersReducedMotion;

  const value = {
    isLowPower,
    isLoaded,
    manualLowPower,
    toggleManualLowPower,
  };

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
};
