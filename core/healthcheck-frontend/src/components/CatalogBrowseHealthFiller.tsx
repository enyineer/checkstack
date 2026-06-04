import React, { useEffect, useMemo } from "react";
import type { SlotContext } from "@checkstack/frontend-api";
import type { CatalogBrowseHealthSlot } from "@checkstack/catalog-common";
import type { CatalogHealthStatuses } from "@checkstack/catalog-common";
import {
  SystemBadgeDataProvider,
  useSystemBadgeData,
} from "@checkstack/dashboard-frontend";

type Props = SlotContext<typeof CatalogBrowseHealthSlot>;

/**
 * Reads the bulk-fetched health from dashboard-frontend's SystemBadgeDataProvider
 * context and reports the per-system statuses back to the catalog browse view via
 * `onStatuses`. Renders nothing — it is a headless reporter inside the provider.
 *
 * Healthcheck's status enum (`healthy` | `degraded` | `unhealthy`) matches the
 * catalog-owned `CatalogHealthStatus` vocabulary exactly, so the mapping is a
 * direct copy of the resolved statuses; systems with no health are simply omitted
 * (the catalog rollup treats absence as `"unknown"`).
 */
const HealthStatusReporter: React.FC<Props> = ({ systemIds, onStatuses }) => {
  const { getSystemBadgeData } = useSystemBadgeData();

  // Stable, serialised status map: `useMemo` keeps the object identity fixed
  // unless `systemIds` or the bulk-data accessor change, so the effect below
  // re-reports only when the resolved statuses actually change.
  const statuses = useMemo<CatalogHealthStatuses>(() => {
    const result: CatalogHealthStatuses = {};
    for (const id of systemIds) {
      const status = getSystemBadgeData(id)?.health?.status;
      if (status) result[id] = status;
    }
    return result;
  }, [systemIds, getSystemBadgeData]);

  useEffect(() => {
    onStatuses(statuses);
  }, [statuses, onStatuses]);

  return null;
};

/**
 * Fills the catalog `CatalogBrowseHealthSlot`. Wraps dashboard-frontend's existing
 * `SystemBadgeDataProvider` (already a healthcheck-frontend dependency) over the
 * browse list's system ids to bulk-fetch health, then reports the resolved
 * statuses to catalog. All cross-plugin coupling lives here on the filler side;
 * catalog stays decoupled.
 */
export const CatalogBrowseHealthFiller: React.FC<Props> = ({
  systemIds,
  onStatuses,
}) => {
  return (
    <SystemBadgeDataProvider systemIds={systemIds}>
      <HealthStatusReporter systemIds={systemIds} onStatuses={onStatuses} />
    </SystemBadgeDataProvider>
  );
};
