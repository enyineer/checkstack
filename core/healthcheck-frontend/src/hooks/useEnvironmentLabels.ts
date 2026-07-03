import { usePluginClient } from "@checkstack/frontend-api";
import { CatalogApi } from "@checkstack/catalog-common";
import type { EnvironmentLabel } from "../components/HealthCheckRunsTable";

/**
 * Resolves display names for run-row environment pills from ALL environments in
 * the instance, not just those currently assigned to a system. A run recorded
 * for an environment that was later UNASSIGNED still shows the environment's
 * name instead of its raw id; a truly DELETED environment isn't returned here,
 * so the run chip falls back to a "Removed environment" label.
 *
 * `isLoading` lets callers hold the run list until names are ready, so a
 * still-loading environment can't briefly render as "Removed environment".
 */
export function useEnvironmentLabels(): {
  environmentLabels: EnvironmentLabel[];
  isLoading: boolean;
} {
  const catalogClient = usePluginClient(CatalogApi);
  const { data: environments = [], isLoading } =
    catalogClient.listEnvironments.useQuery();
  return { environmentLabels: environments, isLoading };
}
