import { useEffect, useRef } from "react";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { TipsApi } from "@checkstack/tips-common";

/**
 * Headless extension that prefetches the user's dismissed-tips list as
 * soon as the session is known. Without this, the very first <Tip> on
 * the page would have to issue its own request — visible as a brief
 * flash of an already-dismissed popover.
 *
 * Renders nothing; mounted into NavbarRightSlot so it's present on every
 * page that uses the standard layout.
 */
export const TipsSynchronizer = () => {
  const authApi = useApi(authApiRef);
  const tipsClient = usePluginClient(TipsApi);
  const { data: session, isPending } = authApi.useSession();
  const lastUserIdRef = useRef<string | undefined>(undefined);

  // The query is keyed by react-query under the plugin's key; using
  // `useQuery` here is enough to populate the cache for any later
  // `useTipState` consumer.
  const dismissedQuery = tipsClient.listDismissed.useQuery(undefined, {
    enabled: !!session?.user && !isPending,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    const currentUserId = session?.user?.id ?? undefined;
    if (currentUserId !== lastUserIdRef.current) {
      lastUserIdRef.current = currentUserId;
      // Force a refetch when the user changes (login/logout/switch).
      // staleTime is Infinity, so without this we'd keep the previous
      // user's dismissals in the cache.
      if (currentUserId) {
        void dismissedQuery.refetch();
      }
    }
  }, [session?.user?.id, dismissedQuery]);

  return null;
};
