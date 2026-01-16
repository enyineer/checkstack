import type { ContractRouterClient, AnyContractRouter } from "@orpc/contract";
import type { PluginMetadata } from "./plugin-metadata";
import type { ProcedureMetadata } from "./types";

/**
 * A client definition that bundles an RPC contract with its plugin metadata.
 * Used for type-safe plugin RPC consumption and TanStack Query integration.
 *
 * @example
 * ```typescript
 * // Define in auth-common
 * export const AuthApi = createClientDefinition(authContract, pluginMetadata);
 *
 * // Use in frontend with TanStack Query hooks
 * const authClient = usePluginClient(AuthApi);
 * const { data } = authClient.getUser.useQuery({ id });
 * ```
 */
export interface ClientDefinition<
  TContract extends AnyContractRouter = AnyContractRouter
> {
  readonly pluginId: string;
  readonly contract: TContract;
  /**
   * Phantom type for contract type inference.
   * This property doesn't exist at runtime - it's only used by TypeScript
   * to carry the contract type information for type inference.
   */
  readonly __contractType?: TContract;
}

/**
 * Type helper to extract the client type from a ClientDefinition.
 *
 * @example
 * ```typescript
 * type AuthClient = InferClient<typeof AuthApi>;
 * // Equivalent to: ContractRouterClient<typeof authContract>
 * ```
 */
export type InferClient<T extends ClientDefinition> =
  T extends ClientDefinition<infer C> ? ContractRouterClient<C> : never;

/**
 * Type helper to extract operationType from a procedure's metadata.
 */
export type ExtractOperationType<TProcedure> = TProcedure extends {
  "~orpc": { meta: { operationType: infer T } };
}
  ? T
  : "query"; // Default to query if not specified

/**
 * Extracts the contract's metadata for a specific procedure path.
 */
export type InferProcedureMetadata<
  TContract extends AnyContractRouter,
  TPath extends keyof TContract
> = TContract[TPath] extends { "~orpc": { meta: infer M } }
  ? M extends ProcedureMetadata
    ? M
    : never
  : never;

/**
 * Create a typed client definition for a plugin's RPC contract.
 *
 * This bundles the contract with the plugin metadata, enabling type-safe
 * TanStack Query hooks that expose only .useQuery() or .useMutation() based
 * on the procedure's operationType.
 *
 * @param contract - The RPC contract object
 * @param metadata - The plugin metadata from the plugin's plugin-metadata.ts
 * @returns A ClientDefinition object that can be passed to usePluginClient()
 *
 * @example
 * ```typescript
 * // In @checkstack/auth-common
 * import { authContract } from "./rpc-contract";
 * import { pluginMetadata } from "./plugin-metadata";
 *
 * export const AuthApi = createClientDefinition(authContract, pluginMetadata);
 *
 * // In consumer (frontend)
 * const authClient = usePluginClient(AuthApi);
 * const { data } = authClient.getUsers.useQuery({}); // Type-safe!
 * const mutation = authClient.deleteUser.useMutation(); // Type-safe!
 * ```
 */
export function createClientDefinition<TContract extends AnyContractRouter>(
  contract: TContract,
  metadata: PluginMetadata
): ClientDefinition<TContract> {
  return {
    pluginId: metadata.pluginId,
    contract,
  } as ClientDefinition<TContract>;
}
