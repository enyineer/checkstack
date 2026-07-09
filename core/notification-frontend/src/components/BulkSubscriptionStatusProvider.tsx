import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { NotificationApi } from "@checkstack/notification-common";
import {
  catalogSystemTarget,
  catalogGroupTarget,
} from "@checkstack/catalog-common";
import { unionPrimaryGroupIds } from "./bulkSubscriptionStatus.logic";

/**
 * Shared subscription-status lookup for the catalog browse view. The provider
 * fetches the subscription status of EVERY visible bell's primary group ids in
 * one `getMySubscriptionStatus` request; each collapsed bell trigger then reads
 * its status from this context instead of firing its own per-bell request (the
 * N+1 this removes).
 */
export interface BulkSubscriptionStatusContextValue {
  /**
   * True when `groupId` is part of the bulk union — i.e. its subscription
   * status is covered by the shared query, so a bell need not fetch it itself.
   * Independent of whether the query has finished loading.
   */
  covers: (groupId: string) => boolean;
  /**
   * The caller's subscribed flag for `groupId` from the shared query. `false`
   * once loaded and not subscribed; `undefined` when the id is not covered or
   * the query has not resolved yet (a bell that treats undefined as `false`
   * matches the per-bell query's own loading behavior).
   */
  getStatus: (groupId: string) => boolean | undefined;
}

const BulkSubscriptionStatusContext =
  React.createContext<BulkSubscriptionStatusContextValue | null>(null);

/**
 * Optional accessor: returns the bulk context when a
 * {@link BulkSubscriptionStatusProvider} is mounted above (the catalog browse
 * view), or `null` on every other surface (the single-resource system-detail
 * bell), where each bell keeps its own per-bell query.
 */
export function useBulkSubscriptionStatusOptional(): BulkSubscriptionStatusContextValue | null {
  return React.useContext(BulkSubscriptionStatusContext);
}

export interface BulkSubscriptionStatusProviderProps {
  /** Every system id currently rendered in the browse view. */
  systemIds: string[];
  /** Every real group id currently rendered (excludes the ungrouped section). */
  groupIds: string[];
  children?: React.ReactNode;
}

/**
 * Wraps the catalog browse tree and provides the shared subscription-status
 * lookup. Renders `children` exactly once inside its context provider.
 *
 * The union of primary group ids is built from the visible resources and the
 * registered subscription specs: each system id yields its `catalogSystemTarget`
 * resource key (via `keyOf`), each group id its `catalogGroupTarget` resource
 * key, and each resource contributes one group id per matching-target spec. The
 * whole union is fetched in a single request; per-row bells read from it.
 */
export function BulkSubscriptionStatusProvider({
  systemIds,
  groupIds,
  children,
}: BulkSubscriptionStatusProviderProps) {
  const notificationClient = usePluginClient(NotificationApi);

  const { data: specs = [] } = notificationClient.listSubscriptionSpecs.useQuery(
    {},
    { staleTime: 60_000 },
  );

  // `keyOf` derives the resource key from each id. Only the key-bearing field is
  // read (`systemId` / `groupId`); the label fields are irrelevant to the group
  // id, so a placeholder name satisfies the resource shape without affecting the
  // computed key.
  const resources = React.useMemo(
    () => [
      ...systemIds.map((systemId) => ({
        targetTypeId: catalogSystemTarget.targetTypeId,
        resourceKey: catalogSystemTarget.keyOf({ systemId, systemName: "" }),
      })),
      ...groupIds.map((groupId) => ({
        targetTypeId: catalogGroupTarget.targetTypeId,
        resourceKey: catalogGroupTarget.keyOf({ groupId, groupName: "" }),
      })),
    ],
    [systemIds, groupIds],
  );

  const unionGroupIds = React.useMemo(
    () => unionPrimaryGroupIds({ specs, resources }),
    [specs, resources],
  );

  const unionSet = React.useMemo(
    () => new Set(unionGroupIds),
    [unionGroupIds],
  );

  const { data: statusMap = {} } =
    notificationClient.getMySubscriptionStatus.useQuery(
      { groupIds: unionGroupIds },
      { enabled: unionGroupIds.length > 0, staleTime: 30_000 },
    );

  const value = React.useMemo<BulkSubscriptionStatusContextValue>(
    () => ({
      covers: (groupId) => unionSet.has(groupId),
      getStatus: (groupId) =>
        unionSet.has(groupId) ? (statusMap[groupId] ?? false) : undefined,
    }),
    [unionSet, statusMap],
  );

  return (
    <BulkSubscriptionStatusContext.Provider value={value}>
      {children}
    </BulkSubscriptionStatusContext.Provider>
  );
}
