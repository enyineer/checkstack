import React from "react";
import { fetchApiRef, useApi } from "@checkstack/frontend-api";
import type { AcquiredTypeFile } from "@checkstack/ui";
import {
  buildSdkTypesPath,
  pluginMetadata,
  SdkTypesResponseSchema,
} from "@checkstack/script-packages-common";
import { SDK_RELEASE_VERSION } from "@checkstack/sdk/version";

/**
 * Fetch the running release's `@checkstack/sdk` editor bundle (the ambient
 * `.d.ts` for the script-authoring helpers + typed client) so the in-app
 * editor resolves `import { defineHealthCheck } from "@checkstack/sdk/healthcheck"`
 * with real types - never a hand-rolled ambient string that drifts from the
 * published package.
 *
 * Version-keyed + cacheable (mirrors `useScriptPackageTypeAcquisition`): the
 * route is `GET /api/script-packages/sdk-types/:releaseVersion`, served with
 * `Cache-Control: private, max-age=..., immutable`. `SDK_RELEASE_VERSION` is
 * stamped into the frontend bundle at build time and equals the release the
 * backend serves (frontend + backend ship together). The version doubles as
 * the `sdkTypesResetKey` so a deployment upgrade refreshes the SDK libs.
 *
 * If the backend's running version differs (e.g. a tab open across a rolling
 * deploy) the route returns 409 and the hook yields no files that round; a
 * frontend redeploy carries the new stamped version and the editor remounts.
 *
 * Returns `sdkTypes: undefined` until the fetch resolves so the editor simply
 * doesn't mount the SDK libs before they're available.
 */
export function useSdkTypeInjection(): {
  sdkTypes: AcquiredTypeFile[] | undefined;
  sdkTypesResetKey: string;
} {
  const fetchApi = useApi(fetchApiRef);
  const [sdkTypes, setSdkTypes] = React.useState<AcquiredTypeFile[]>();

  const pluginFetch = React.useMemo(
    () => fetchApi.forPlugin(pluginMetadata.pluginId),
    [fetchApi],
  );

  React.useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const path = buildSdkTypesPath({ releaseVersion: SDK_RELEASE_VERSION });
      try {
        const response = await pluginFetch.fetch(path);
        if (!response.ok) {
          // 409 stale-version or any error: no SDK types this round. A redeploy
          // bumps the stamped version and re-runs this effect.
          if (!cancelled) setSdkTypes([]);
          return;
        }
        const json: unknown = await response.json();
        const parsed = SdkTypesResponseSchema.safeParse(json);
        if (!cancelled) setSdkTypes(parsed.success ? parsed.data.files : []);
      } catch {
        if (!cancelled) setSdkTypes([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [pluginFetch]);

  return { sdkTypes, sdkTypesResetKey: SDK_RELEASE_VERSION };
}
