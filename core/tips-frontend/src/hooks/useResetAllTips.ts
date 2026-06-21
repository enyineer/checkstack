import { useCallback, useMemo } from "react";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { TipsApi } from "@checkstack/tips-common";
import { useLocalDismissals } from "./useLocalDismissals";

export interface UseResetAllTipsResult {
  /**
   * Restore every dismissed tip for the current user so the "replay
   * onboarding" coaching shows again. Clears both the local-storage store
   * (anonymous / offline fallback) and, for logged-in users, the server copy.
   */
  resetAll: () => void;
  /** True while the reset mutation is in flight (logged-in users only). */
  isResetting: boolean;
}

/**
 * Wires the documented "replay onboarding" capability: `TipsApi.reset` with no
 * `tipIds` clears ALL of the current user's dismissed tips. Pairs with a
 * "Show tips again" affordance in the help menu.
 *
 * Mirrors {@link useTipState}'s persistence model: local dismissals are always
 * cleared for instant feedback, and the server copy is cleared for logged-in
 * users so the reset survives a reload / other devices.
 */
export const useResetAllTips = (): UseResetAllTipsResult => {
  const authApi = useApi(authApiRef);
  const tipsClient = usePluginClient(TipsApi);
  const { data: session, isPending: sessionPending } = authApi.useSession();
  const local = useLocalDismissals();

  const isLoggedIn = !!session?.user;

  const { mutate: resetMutate, isPending: resetPending } =
    tipsClient.reset.useMutation();

  const dismissedQuery = tipsClient.listDismissed.useQuery(undefined, {
    enabled: isLoggedIn && !sessionPending,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const refetch = dismissedQuery.refetch;

  const resetAll = useCallback(() => {
    // Clear the local store for instant feedback and anonymous use.
    local.reset();
    if (isLoggedIn) {
      // Omitting `tipIds` clears ALL of the user's dismissed tips.
      resetMutate(
        {},
        {
          onSuccess: () => {
            void refetch();
          },
        },
      );
    }
  }, [isLoggedIn, resetMutate, refetch, local]);

  return useMemo(
    () => ({ resetAll, isResetting: isLoggedIn && resetPending }),
    [resetAll, isLoggedIn, resetPending],
  );
};
