import { usePluginClient } from "@checkstack/frontend-api";
import { ScriptPackagesApi } from "@checkstack/script-packages-common";

/**
 * Fetch the rolled-up `.d.ts` for every installed package and merge it into
 * a single string suitable for appending to the `typeDefinitions` prop that
 * flows through `DynamicForm -> CodeEditor -> Monaco addExtraLib`.
 *
 * Because that prop reaches every script field, calling this in a feature
 * page and concatenating the result gives package IntelliSense in every
 * editor for free. Packages without bundled types contribute nothing (they
 * still run; they just lack autocomplete).
 *
 * Returns `""` until loaded so callers can unconditionally concatenate.
 */
export function useScriptPackageTypes(): {
  dts: string;
  isLoading: boolean;
} {
  const client = usePluginClient(ScriptPackagesApi);
  const query = client.listPackageTypes.useQuery(undefined, {
    // Package types change rarely (only on install); cache generously.
    staleTime: 5 * 60 * 1000,
  });

  const dts = (query.data?.items ?? [])
    .map((item) => item.dts)
    .filter((d) => d.length > 0)
    .join("\n");

  return { dts, isLoading: query.isLoading };
}
