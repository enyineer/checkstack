import React from "react";
import { useApi, rpcApiRef, useSlotExtensions } from "@checkstack/frontend-api";
import type { OptionsResolver } from "@checkstack/ui";
import { HealthCheckConfigOptionsResolverSlot } from "./slot";
import { buildResolverMap, createResolverProxy } from "./registry.logic";

/**
 * Build the `optionsResolvers` map for the health-check editor's strategy and
 * collector config forms, from whatever plugins have contributed factories for
 * the strategy being edited (see {@link HealthCheckConfigOptionsResolverSlot}).
 *
 * Returns a STABLE object safe to pass to every `DynamicForm` in the editor:
 * each name resolves against the latest strategy config at call time, so the
 * reference never changes and cannot churn the forms, while still reflecting the
 * operator's current selection (e.g. a collector's pattern picker following the
 * strategy's chosen stream).
 */
export function useConfigOptionsResolvers({
  strategyId,
  strategyConfig,
}: {
  strategyId: string | undefined;
  strategyConfig: Record<string, unknown>;
}): Record<string, OptionsResolver> {
  const extensions = useSlotExtensions(HealthCheckConfigOptionsResolverSlot);
  const rpcApi = useApi(rpcApiRef);

  // Rebuild the concrete map whenever the contributions, strategy, config, or
  // client change. Held in a ref so the stable proxy below always reads the
  // latest map without itself being re-created.
  const resolverMap = React.useMemo(
    () =>
      buildResolverMap({
        extensions,
        strategyId,
        ctx: { rpcApi, strategyConfig },
      }),
    [extensions, strategyId, rpcApi, strategyConfig],
  );
  const resolverMapRef = React.useRef(resolverMap);
  resolverMapRef.current = resolverMap;

  // One stable proxy for the editor's lifetime; it reads the ref at call time.
  return React.useMemo(
    () => createResolverProxy({ getResolvers: () => resolverMapRef.current }),
    [],
  );
}
