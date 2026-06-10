import React from "react";
import type { System } from "@checkstack/catalog-common";
import { ResourceManagedBy } from "./ResourceManagedBy";

/**
 * Fills catalog's `SystemMetaSlot`: a read-only "who can change this" indicator
 * for a system, shown in the system detail sidebar. Renders nothing when the
 * system is not team-scoped or the viewer lacks teams.read.
 */
export const SystemAccessMeta: React.FC<{ system: System }> = ({ system }) => {
  return <ResourceManagedBy resourceType="catalog.system" resourceId={system.id} />;
};
