import { createApiRef } from "@checkmate/frontend-api";
import type { ContractRouterClient } from "@orpc/contract";
import { catalogContract } from "@checkmate/catalog-common";

// Re-export types for convenience
export type { System, Group, View, Incident } from "@checkmate/catalog-common";

// CatalogApi is the client type derived from the contract
export type CatalogApi = ContractRouterClient<typeof catalogContract>;

export const catalogApiRef = createApiRef<CatalogApi>("plugin.catalog.api");
