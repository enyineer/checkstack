import { useEffect, useRef } from "react";
import { useApi, rpcApiRef } from "@checkmate-monitor/frontend-api";
import { authApiRef } from "@checkmate-monitor/auth-frontend/api";
import { useTheme } from "@checkmate-monitor/ui";
import { ThemeApi } from "@checkmate-monitor/theme-common";

/**
 * Headless component that synchronizes theme on app initialization.
 *
 * - For logged-in users: fetches theme from backend and applies it
 * - For non-logged-in users: theme is already read from local storage by ThemeProvider
 * - Also syncs backend theme to local storage for continuity when logging out
 *
 * Must be rendered early in the app (e.g., via NavbarRightSlot) to ensure theme
 * is applied before the user sees the page.
 */
export const ThemeSynchronizer = () => {
  const { setTheme } = useTheme();
  const authApi = useApi(authApiRef);
  const rpcApi = useApi(rpcApiRef);
  const themeClient = rpcApi.forPlugin(ThemeApi);
  const { data: session, isPending } = authApi.useSession();

  // Track if we've already synced for this session to avoid repeated API calls
  const hasSyncedRef = useRef(false);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Wait for session to load
    if (isPending) {
      return;
    }

    const currentUserId = session?.user?.id ?? undefined;

    // Reset sync state when user changes (login/logout)
    if (currentUserId !== lastUserIdRef.current) {
      hasSyncedRef.current = false;
      lastUserIdRef.current = currentUserId;
    }

    // Only sync once per session
    if (hasSyncedRef.current) {
      return;
    }

    // For logged-in users, fetch theme from backend
    if (session?.user) {
      themeClient
        .getTheme()
        .then(({ theme }) => {
          setTheme(theme);
          hasSyncedRef.current = true;
        })
        .catch((error) => {
          console.error("Failed to sync theme from backend:", error);
          hasSyncedRef.current = true; // Still mark as synced to prevent retry loops
        });
    } else {
      // For non-logged-in users, local storage theme is already applied
      // by ThemeProvider, so nothing to do
      hasSyncedRef.current = true;
    }
  }, [session, isPending, setTheme, themeClient]);

  // Headless component - renders nothing
  return <></>;
};
