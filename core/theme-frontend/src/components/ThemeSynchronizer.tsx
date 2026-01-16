import { useEffect, useRef } from "react";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { useTheme } from "@checkstack/ui";
import { ThemeApi } from "@checkstack/theme-common";

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
  const themeClient = usePluginClient(ThemeApi);
  const { data: session, isPending } = authApi.useSession();

  // Track if we've already synced for this session to avoid repeated API calls
  const hasSyncedRef = useRef(false);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  // Fetch theme from backend - only enabled when user is logged in
  const { data: themeData, isSuccess } = themeClient.getTheme.useQuery(
    undefined,
    {
      enabled: !!session?.user && !isPending && !hasSyncedRef.current,
      staleTime: Infinity, // Don't refetch automatically
    }
  );

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

    // For logged-in users, apply theme from backend when query succeeds
    if (session?.user && isSuccess && themeData) {
      setTheme(themeData.theme);
      hasSyncedRef.current = true;
    } else if (!session?.user) {
      // For non-logged-in users, local storage theme is already applied
      // by ThemeProvider, so nothing to do
      hasSyncedRef.current = true;
    }
  }, [session, isPending, setTheme, themeData, isSuccess]);

  // Headless component - renders nothing
  return <></>;
};
