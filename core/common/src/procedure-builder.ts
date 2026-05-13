import { oc } from "@orpc/contract";
import type { ContractProcedureBuilder } from "@orpc/contract";
import type { Schema, ErrorMap } from "@orpc/contract";
import type { ProcedureMetadata } from "./types";

/**
 * Return type of proc() that preserves the operationType in the type system.
 * This extends ContractProcedureBuilder but with our specific ProcedureMetadata.
 */
export type TypedContractProcedureBuilder<TMeta extends ProcedureMetadata> =
  ContractProcedureBuilder<
    Schema<unknown, unknown>,
    Schema<unknown, unknown>,
    ErrorMap,
    TMeta
  >;

/**
 * Creates an oRPC procedure builder with required metadata.
 * All procedures MUST provide userType, operationType, and access.
 *
 * The return type preserves the operationType in the generic parameter,
 * enabling type-safe hook selection (useQuery vs useMutation) in usePluginClient.
 *
 * REST shape (via `/rest/:pluginId/*` mounted with oRPC's OpenAPIHandler):
 * queries default to HTTP `GET` (input encoded into the URL as bracket-notation
 * query params, e.g. `?ids[0]=a&ids[1]=b`); mutations default to `POST` with the
 * input as the JSON body.
 *
 * Override the method by chaining `.route({ method: "..." })` after
 * `proc({...})`. The repo convention is:
 *   - `create*` / `add*`              → `POST`   (default for mutations)
 *   - `update*`                       → `PATCH`  (partial updates)
 *   - `delete*` / `remove*`           → `DELETE`
 *   - `getBulk*` and any query with   → `POST`   (avoid URL-length limits;
 *     a large array input                         no automatic GET→POST fallback
 *                                                 in `@orpc/openapi@1.13.x`)
 *
 * Constraint to know about: when method is `GET` (the default for queries),
 * the input schema must be an `object`, `any`, or `unknown` — never a bare
 * scalar like `z.string()`. GET has no field name to attach a top-level scalar
 * to in a query string, so oRPC's OpenAPI generator throws at boot. Wrap the
 * input in an object (`z.object({ id: z.string() })`) or, if the existing call
 * sites can't be migrated, override the method to `POST`.
 *
 * @example
 * ```typescript
 * import { proc } from "@checkstack/common";
 *
 * export const myContract = {
 *   // GET /rest/myplugin/getItems
 *   getItems: proc({
 *     operationType: "query",
 *     userType: "public",
 *     access: [myAccess.items.read],
 *   }).output(z.array(ItemSchema)),
 *
 *   // POST /rest/myplugin/createItem
 *   createItem: proc({
 *     operationType: "mutation",
 *     userType: "authenticated",
 *     access: [myAccess.items.manage],
 *   })
 *     .input(CreateItemSchema)
 *     .output(ItemSchema),
 *
 *   // POST /rest/myplugin/getBulkItems — bulk query overrides default GET
 *   // because `ids` can be too long for a query string.
 *   getBulkItems: proc({
 *     operationType: "query",
 *     userType: "public",
 *     access: [myAccess.items.read],
 *   })
 *     .route({ method: "POST" })
 *     .input(z.object({ ids: z.array(z.string()) })),
 * };
 * ```
 */
export function proc<TMeta extends ProcedureMetadata>(
  meta: TMeta
): TypedContractProcedureBuilder<TMeta> {
  const defaultMethod = meta.operationType === "query" ? "GET" : "POST";
  return oc
    .$meta<TMeta>(meta)
    .route({ method: defaultMethod }) as TypedContractProcedureBuilder<TMeta>;
}
