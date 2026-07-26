import { useEffect, useCallback, useMemo, useState } from "react";
import {
  createFrontendPlugin,
  NavbarCenterSlot,
  usePluginClient,
} from "@checkstack/frontend-api";
import {
  CommandApi,
  pluginMetadata,
  type SearchResult,
} from "@checkstack/command-common";
import { NavbarSearch } from "./components/NavbarSearch";

// =============================================================================
// PLUGIN
// =============================================================================

export const commandPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    {
      id: "command.navbar.search",
      slot: NavbarCenterSlot,
      component: NavbarSearch,
    },
  ],
});

// =============================================================================
// PALETTE OPENER
// =============================================================================

/**
 * Programmatically open the global search palette from anywhere in the app
 * (e.g. a mobile-drawer search entry) without duplicating its open state.
 *
 * The palette's open state is owned by {@link NavbarSearch}, which listens for
 * the ⌘K / Ctrl+K shortcut globally. Re-dispatching that same synthetic
 * keyboard event keeps a single source of truth for the dialog instead of
 * threading shared state through the shell.
 */
export function openSearchPalette(): void {
  if (typeof document === "undefined") return;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
    }),
  );
}

// =============================================================================
// SHORTCUT UTILITIES (Frontend-only - requires DOM types)
// =============================================================================

interface ParsedShortcut {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/**
 * Parse a shortcut string like "meta+shift+k" into components.
 */
function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  return {
    meta: parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
    key,
  };
}

/**
 * Check if a keyboard event matches a parsed shortcut.
 */
function matchesShortcut(
  event: KeyboardEvent,
  shortcut: ParsedShortcut
): boolean {
  return (
    event.metaKey === shortcut.meta &&
    event.ctrlKey === shortcut.ctrl &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift &&
    event.key.toLowerCase() === shortcut.key
  );
}

/**
 * Format a shortcut for display.
 * "meta+i" → "⌘I" on Mac, "Ctrl+I" on Windows
 */
export function formatShortcut(shortcut: string, isMac: boolean): string {
  const parsed = parseShortcut(shortcut);
  const parts: string[] = [];

  if (parsed.ctrl) {
    parts.push(isMac ? "⌃" : "Ctrl");
  }
  if (parsed.alt) {
    parts.push(isMac ? "⌥" : "Alt");
  }
  if (parsed.shift) {
    parts.push(isMac ? "⇧" : "Shift");
  }
  if (parsed.meta) {
    parts.push(isMac ? "⌘" : "Win");
  }
  parts.push(parsed.key.toUpperCase());

  return isMac ? parts.join("") : parts.join("+");
}

// =============================================================================
// DEBOUNCE HOOK
// =============================================================================

/**
 * Hook to debounce a value by the specified delay.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook that registers global keyboard shortcuts for commands.
 * When a shortcut is triggered, it navigates to the command's route.
 * Should be used once at the app root level.
 *
 * The command list is ALREADY access-filtered by the server (global rules OR a
 * team grant on the command's `manageCapability` type), so this hook does not
 * re-check access. It previously took a `userAccessRules` argument and re-tested
 * the GLOBAL rules - which both call sites defeated by passing `["*"]`, and which
 * would have dropped team-scoped users' shortcuts had they not.
 *
 * @param commands - Array of commands with shortcuts (server-filtered)
 * @param navigate - Navigation function to call when a command is triggered
 */
export function useGlobalShortcuts(
  commands: SearchResult[],
  navigate: (route: string) => void,
): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Find matching command
      for (const command of commands) {
        if (!command.shortcuts || !command.route) continue;

        // NO access re-check here. The server already filtered this list by the
        // caller's global rules OR a team grant on the command's declared
        // `manageCapability` type. Re-checking the GLOBAL rules only (as this
        // did) contradicted that and silently dropped the shortcuts of
        // team-scoped users - who hold no global `*.manage` rule but are
        // authorized via their team - so "Create Incident" had a visible palette
        // entry whose keyboard shortcut did nothing. The destination route
        // carries its own guard regardless.

        for (const shortcut of command.shortcuts) {
          const parsed = parseShortcut(shortcut);
          if (matchesShortcut(event, parsed)) {
            event.preventDefault();
            navigate(command.route);
            return;
          }
        }
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [commands, navigate]);
}

/**
 * Hook to format a shortcut string for the current platform.
 */
export function useFormatShortcut(): (shortcut: string) => string {
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad/.test(navigator.userAgent),
    []
  );

  return useCallback(
    (shortcut: string) => formatShortcut(shortcut, isMac),
    [isMac]
  );
}

/**
 * Hook for debounced search in the command palette.
 * Uses TanStack Query with a debounced query state.
 */
export function useDebouncedSearch(delayMs: number = 300): {
  results: SearchResult[];
  loading: boolean;
  setQuery: (query: string) => void;
  reset: () => void;
} {
  const commandClient = usePluginClient(CommandApi);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, delayMs);

  // useQuery automatically refetches when debouncedQuery changes
  const { data, isLoading } = commandClient.search.useQuery(
    { query: debouncedQuery },
    { staleTime: 30_000 } // Cache results for 30 seconds
  );

  const reset = useCallback(() => {
    setQuery("");
  }, []);

  return {
    results: data ?? [],
    loading: isLoading,
    setQuery,
    reset,
  };
}

// =============================================================================
// GLOBAL SHORTCUTS COMPONENT
// =============================================================================

/**
 * Hook to fetch commands with shortcuts from the backend.
 * Returns commands that can be used with useGlobalShortcuts.
 */
export function useCommands(): {
  commands: SearchResult[];
  loading: boolean;
} {
  const commandClient = usePluginClient(CommandApi);

  // Fetch all commands (empty query returns all)
  const { data, isLoading } = commandClient.getCommands.useQuery(undefined, {
    staleTime: 60_000, // Cache for 1 minute
  });

  // Filter to only commands with shortcuts
  const commandsWithShortcuts = useMemo(
    () => (data ?? []).filter((r) => r.shortcuts && r.shortcuts.length > 0),
    [data]
  );

  return { commands: commandsWithShortcuts, loading: isLoading };
}

/**
 * Component that registers global keyboard shortcuts for commands.
 * Mount this at the app root level (e.g., in Layout or App).
 *
 * @example
 * ```tsx
 * import { GlobalShortcuts } from "@checkstack/command-frontend";
 *
 * function App() {
 *   return (
 *     <>
 *       <GlobalShortcuts />
 *       {/* rest of app *\/}
 *     </>
 *   );
 * }
 * ```
 */
export function GlobalShortcuts(): React.ReactNode {
  const { commands } = useCommands();
  const navigate = useCallback((route: string) => {
    // Use window.location for reliable navigation
    globalThis.location.href = route;
  }, []);

  // For now, pass "*" as access rule since the backend already filters
  // The commands returned from getCommands are already filtered
  useGlobalShortcuts(commands, navigate);

  // This component renders nothing - it only registers event listeners
  return;
}
