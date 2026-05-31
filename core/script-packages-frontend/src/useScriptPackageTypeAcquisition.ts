import React from "react";
import { fetchApiRef, useApi, usePluginClient } from "@checkstack/frontend-api";
import type { AcquireTypes, AcquiredTypeFile } from "@checkstack/ui";
import { importablePackageNames } from "@checkstack/ui";
import {
  buildTypeAcquisitionPath,
  PackageTypeClosureSchema,
  pluginMetadata,
  ScriptPackagesApi,
} from "@checkstack/script-packages-common";

/**
 * Provide the lazy Automatic Type Acquisition (ATA) wiring for script
 * editors: an `acquireTypes` resolver that fetches one package's `.d.ts`
 * closure from the cacheable backend route, the current `lockfileHash` as the
 * editor's `acquireResetKey` (so types refresh after a new install), and the
 * importable package names so the import specifier itself autocompletes.
 *
 * The resolver targets `GET /api/script-packages/types/:hash/:specifier`,
 * which sets `Cache-Control: private, max-age=..., immutable` — so once a
 * package's closure is fetched for an install, the browser serves it from
 * cache until a new install changes the hash. The in-editor acquired-set
 * dedupes within a session; the HTTP cache dedupes across reloads.
 *
 * `importablePackages` comes from the installed manifest (what is actually
 * resolvable at runtime), with `@types/*` companions excluded — you import
 * `lodash`, never `@types/lodash` (the `@types` still back the closure types).
 *
 * Returns `acquireTypes: undefined` until the install hash is known, so the
 * editor simply doesn't attempt ATA before packages are ready.
 */
export function useScriptPackageTypeAcquisition(): {
  acquireTypes: AcquireTypes | undefined;
  acquireResetKey: string | undefined;
  importablePackages: string[];
} {
  const fetchApi = useApi(fetchApiRef);
  const client = usePluginClient(ScriptPackagesApi);

  // The current desired install state. Cached generously — it only changes on
  // an install. The hash keys the route + gates/resets acquisition; the
  // manifest is the source of importable names.
  const installStateQuery = client.getInstallState.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 },
  );
  const lockfileHash = installStateQuery.data?.lockfileHash ?? undefined;
  const manifest = installStateQuery.data?.manifest;

  // Importable package names from the manifest, `@types/*`-free, deduped +
  // sorted. The manifest includes transitive deps too, all of which resolve
  // from the flat `node_modules` at runtime, so they are all importable.
  const importablePackages = React.useMemo(
    () => importablePackageNames((manifest ?? []).map((entry) => entry.name)),
    [manifest],
  );

  const pluginFetch = React.useMemo(
    () => fetchApi.forPlugin(pluginMetadata.pluginId),
    [fetchApi],
  );

  const acquireTypes = React.useMemo<AcquireTypes | undefined>(() => {
    // No install yet -> no resolver; the editor simply doesn't attempt ATA.
    if (!lockfileHash) return;
    const hash = lockfileHash;
    return async (specifier: string): Promise<AcquiredTypeFile[]> => {
      const path = buildTypeAcquisitionPath({ lockfileHash: hash, specifier });
      const response = await pluginFetch.fetch(path);
      if (!response.ok) {
        // A stale-hash 409 or any error: no types this round. The editor
        // treats an empty result as "acquired" so it won't hammer the route;
        // a later install bumps the hash and resets the acquired-set.
        return [];
      }
      const json: unknown = await response.json();
      const parsed = PackageTypeClosureSchema.safeParse(json);
      if (!parsed.success) return [];
      return parsed.data.files;
    };
  }, [lockfileHash, pluginFetch]);

  return { acquireTypes, acquireResetKey: lockfileHash, importablePackages };
}
