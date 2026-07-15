import React from "react";
import { ExtensionSlot } from "@checkstack/frontend-api";
import {
  CatalogBrowseHealthSlot,
  type CatalogHealthStatuses,
} from "@checkstack/catalog-common";

export interface CatalogBrowseHealthProps {
  /** Every system id currently in the browse view (the bulk-fetch input). */
  systemIds: string[];
  /** Receives the resolved per-system statuses from the slot filler. */
  onStatuses: (statuses: CatalogHealthStatuses) => void;
  /** Receives the filler's bulk-health load state (for a loading placeholder). */
  onLoading?: (loading: boolean) => void;
}

/**
 * Headless boundary that renders the optional `CatalogBrowseHealthSlot`. A health
 * provider plugin (e.g. healthcheck-frontend) fills the slot to bulk-fetch system
 * health and report it via `onStatuses`; the browse page feeds that DATA into its
 * group rollups + health filter (see `healthRollup.logic`). When the slot is
 * unfilled, `ExtensionSlot` renders nothing and no statuses are reported — the
 * page then shows counts only and disables the health filter.
 *
 * Catalog only CONSUMES the slot here; all cross-plugin coupling lives on the
 * filler side, so catalog stays decoupled from any health provider.
 */
export const CatalogBrowseHealth: React.FC<CatalogBrowseHealthProps> = ({
  systemIds,
  onStatuses,
  onLoading,
}) => {
  return (
    <ExtensionSlot
      slot={CatalogBrowseHealthSlot}
      context={{ systemIds, onStatuses, onLoading }}
    />
  );
};
