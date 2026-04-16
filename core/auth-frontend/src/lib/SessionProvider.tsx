import React, { createContext, useContext } from "react";
import { getAuthClientLazy } from "./auth-client";
import type { AuthSession } from "../api";

// =============================================================================
// SESSION CONTEXT
// =============================================================================

interface SessionContextValue {
  data: AuthSession | undefined;
  isPending: boolean;
  error: Error | undefined;
}

const SessionContext = createContext<SessionContextValue>({
  data: undefined,
  isPending: true,
  error: undefined,
});

// =============================================================================
// PROVIDER
// =============================================================================

/**
 * SessionProvider fetches the session exactly once at the top of the tree
 * and distributes the result via React context.
 *
 * All consumers calling `authApi.useSession()` read from this context
 * instead of each independently fetching `/api/auth/get-session`.
 *
 * Must be placed inside RuntimeConfigProvider (needs baseUrl for the client).
 */
export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data, isPending, error } = getAuthClientLazy().useSession();

  const value: SessionContextValue = {
    data: data as AuthSession | undefined,
    isPending,
    error: error as Error | undefined,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Read session data from the SessionProvider context.
 *
 * This does NOT trigger a fetch — it reads the value provided by the
 * single SessionProvider at the top of the tree.
 *
 * @throws If called outside a SessionProvider
 */
export function useSessionContext(): SessionContextValue {
  return useContext(SessionContext);
}
