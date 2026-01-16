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
 * @example
 * ```typescript
 * import { proc } from "@checkstack/common";
 *
 * export const myContract = {
 *   // Returns TypedContractProcedureBuilder<{ operationType: "query", ... }>
 *   getItems: proc({
 *     operationType: "query",
 *     userType: "public",
 *     access: [myAccess.items.read],
 *   }).output(z.array(ItemSchema)),
 *
 *   // Returns TypedContractProcedureBuilder<{ operationType: "mutation", ... }>
 *   createItem: proc({
 *     operationType: "mutation",
 *     userType: "authenticated",
 *     access: [myAccess.items.manage],
 *   })
 *     .input(CreateItemSchema)
 *     .output(ItemSchema),
 * };
 * ```
 */
export function proc<TMeta extends ProcedureMetadata>(
  meta: TMeta
): TypedContractProcedureBuilder<TMeta> {
  return oc.$meta<TMeta>(meta) as TypedContractProcedureBuilder<TMeta>;
}
