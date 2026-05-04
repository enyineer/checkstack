import { useCallback, useMemo } from "react";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { qualifyTipId, TipsApi } from "@checkstack/tips-common";
import type { PluginMetadata } from "@checkstack/common";
import { useLocalDismissals } from "./useLocalDismissals";

export interface UseTipStateOptions {
  /**
   * The calling plugin's metadata. The plugin's `pluginId` is automatically
   * prepended to `id` to produce the fully-qualified tip identifier — plugins
   * never construct that string themselves, which prevents one plugin from
   * dismissing or forging tips in another plugin's namespace.
   */
  plugin: Pick<PluginMetadata, "pluginId">;

  /**
   * Local tip identifier — the part *after* the plugin's namespace.
   *
   * Must not start or end with a `.` and must not contain the plugin
   * separator manually. Examples: `"systems.create"`, `"first-run"`.
   */
  id: string;
}

export interface UseTipStateResult {
  /** Fully-qualified tip ID (`<pluginId>.<id>`) — useful for logs / analytics. */
  tipId: string;
  /** True once we know the tip should not be shown to this user. */
  isDismissed: boolean;
  /**
   * True while the dismissal list is being fetched for the first time.
   * Consumers should typically render nothing while loading — showing a tip
   * and then hiding it would be flicker.
   */
  isLoading: boolean;
  /** Mark this tip dismissed. Idempotent and safe to call repeatedly. */
  dismiss: () => void;
  /** Restore this tip so it shows again. Useful for "replay onboarding". */
  reset: () => void;
}

/**
 * Hook for reading and updating the dismissal state of a single tip.
 *
 * Persistence model:
 * - Logged-in users: state lives on the server in `user_tip_dismissal`; fetched
 *   once per session and kept in sync via react-query. Mutations optimistically
 *   update the cache.
 * - Anonymous users: state lives in `localStorage` under
 *   `checkstack.tips.dismissed` and syncs across tabs via the `storage` event.
 *
 * Both stores are consulted on read, so a tip dismissed locally while logged
 * out stays dismissed after sign-in (the server copy then takes over once
 * the user dismisses it again).
 */
export const useTipState = ({
  plugin,
  id,
}: UseTipStateOptions): UseTipStateResult => {
  const tipId = useMemo(() => qualifyTipId(plugin, id), [plugin, id]);

  const authApi = useApi(authApiRef);
  const tipsClient = usePluginClient(TipsApi);
  const { data: session, isPending: sessionPending } = authApi.useSession();
  const local = useLocalDismissals();

  const isLoggedIn = !!session?.user;

  const dismissedQuery = tipsClient.listDismissed.useQuery(undefined, {
    enabled: isLoggedIn && !sessionPending,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Pull only the stable `mutate` references so we don't capture the entire
  // mutation result object in dependency arrays — that object is recreated
  // every render and would re-run our callbacks unnecessarily.
  const { mutate: dismissMutate } = tipsClient.dismiss.useMutation();
  const { mutate: resetMutate } = tipsClient.reset.useMutation();

  const refetch = dismissedQuery.refetch;

  const isDismissed = useMemo(() => {
    if (local.ids.has(tipId)) return true;
    if (!isLoggedIn) return false;
    if (!dismissedQuery.data) return false;
    return dismissedQuery.data.dismissed.some((d) => d.tipId === tipId);
  }, [tipId, isLoggedIn, dismissedQuery.data, local.ids]);

  const dismiss = useCallback(() => {
    // Always reflect locally for instant feedback and offline / anonymous use.
    local.dismiss(tipId);
    if (isLoggedIn) {
      dismissMutate(
        { tipId },
        {
          onSuccess: () => {
            void refetch();
          },
        },
      );
    }
  }, [tipId, isLoggedIn, dismissMutate, refetch, local]);

  const reset = useCallback(() => {
    local.reset([tipId]);
    if (isLoggedIn) {
      resetMutate(
        { tipIds: [tipId] },
        {
          onSuccess: () => {
            void refetch();
          },
        },
      );
    }
  }, [tipId, isLoggedIn, resetMutate, refetch, local]);

  // While we don't yet know the server answer for a logged-in user, we
  // consider the state "loading" — the consumer can decide whether to
  // suppress rendering to avoid flicker.
  const isLoading =
    sessionPending || (isLoggedIn && dismissedQuery.isPending);

  return { tipId, isDismissed, isLoading, dismiss, reset };
};
