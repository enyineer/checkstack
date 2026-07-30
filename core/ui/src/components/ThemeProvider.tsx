import React, { useContext, useEffect, useState } from "react";
import { createRegisteredContext } from "../utils/registered-context";
import {
  DARK_SCHEME_QUERY,
  parseStoredTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "./ThemeProvider.logic";

export type { Theme, ResolvedTheme } from "./ThemeProvider.logic";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  /** The actual resolved theme ("light" or "dark"), accounting for system preference */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

/**
 * Whether the OS currently asks for a dark palette.
 *
 * Guarded because this runs during the initial state initialiser, which also
 * executes in non-DOM environments (SSR, unit tests) where `matchMedia` does
 * not exist. Defaulting to light there matches the CSS default.
 */
const getSystemPrefersDark = (): boolean =>
  globalThis.matchMedia?.(DARK_SCHEME_QUERY).matches ?? false;

const initialState: ThemeProviderState = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {
    // Will be implemented by provider
  },
};

// Registered (singleton) context: shared between the host's provider and a
// plugin's useTheme() even though @checkstack/ui is bundled per consumer.
const ThemeProviderContext = createRegisteredContext<ThemeProviderState>(
  "checkstack.ui.theme",
  initialState,
);

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme = "system",
  storageKey = "checkstack-ui-theme",
  ...props
}) => {
  const [theme, setTheme] = useState<Theme>(() =>
    parseStoredTheme({
      value: globalThis.localStorage?.getItem(storageKey) ?? null,
      fallback: defaultTheme,
    }),
  );

  // The OS preference is STATE, not a value read during render. Read once at
  // mount and then kept current by the listener below, so "Auto" repaints the
  // moment the OS flips instead of waiting for an unrelated re-render. Reading
  // `matchMedia(...).matches` inline during render (as this used to) makes the
  // provider blind to that change - the value is fresh only by accident.
  const [systemPrefersDark, setSystemPrefersDark] =
    useState<boolean>(getSystemPrefersDark);

  useEffect(() => {
    const query = globalThis.matchMedia?.(DARK_SCHEME_QUERY);
    if (!query) return;

    // Re-read on subscribe: the preference can flip between the initial state
    // computation and this effect running.
    setSystemPrefersDark(query.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = resolveTheme({ theme, systemPrefersDark });

  useEffect(() => {
    const root = globalThis.document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (newTheme: Theme) => {
      globalThis.localStorage?.setItem(storageKey, newTheme);
      setTheme(newTheme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
