import { createApiRef } from "@checkmate-monitor/frontend-api";
import { CatalogApi } from "@checkmate-monitor/catalog-common";
import type { InferClient } from "@checkmate-monitor/common";

// Re-export types for convenience
export type { System, Group, View } from "@checkmate-monitor/catalog-common";

// CatalogApi client type inferred from the client definition
export type CatalogApiClient = InferClient<typeof CatalogApi>;

export const catalogApiRef =
  createApiRef<CatalogApiClient>("plugin.catalog.api");
