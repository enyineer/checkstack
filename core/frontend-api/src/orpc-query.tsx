import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createRouterUtils,
  type RouterUtils,
  type ProcedureUtils,
} from "@orpc/react-query";
import type { NestedClient, ClientContext } from "@orpc/client";
import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

// Re-export useQueryClient for cache invalidation in consuming packages
// This ensures all packages use the same React Query instance
export { useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api-context";
import { rpcApiRef } from "./core-apis";
import type { ClientDefinition, InferClient } from "@checkstack/common";
import type { ContractProcedure, AnyContractRouter } from "@orpc/contract";

// =============================================================================
// TYPES
// =============================================================================

type OrpcUtils = RouterUtils<NestedClient<ClientContext>>;

// =============================================================================
// CONTEXT
// =============================================================================

const OrpcQueryContext = createContext<OrpcUtils | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

interface OrpcQueryProviderProps {
  children: ReactNode;
}

/**
 * Provides oRPC React Query utilities to the application.
 * Must be inside ApiProvider and QueryClientProvider.
 */
export const OrpcQueryProvider: React.FC<OrpcQueryProviderProps> = ({
  children,
}) => {
  const rpcApi = useApi(rpcApiRef);

  const orpcUtils = useMemo(() => {
    return createRouterUtils(rpcApi.client as NestedClient<ClientContext>);
  }, [rpcApi.client]);

  return (
    <OrpcQueryContext.Provider value={orpcUtils}>
      {children}
    </OrpcQueryContext.Provider>
  );
};

// =============================================================================
// INTERNAL
// =============================================================================

function useOrpcUtils(): OrpcUtils {
  const context = useContext(OrpcQueryContext);
  if (!context) {
    throw new Error(
      "usePluginClient must be used within OrpcQueryProvider. " +
        "Wrap your app with <OrpcQueryProvider>."
    );
  }
  return context;
}

// =============================================================================
// TYPE HELPERS FOR STRICT operationType INFERENCE
// =============================================================================

/**
 * Query procedure hook interface - only exposes useQuery.
 * Input is optional when the procedure has no input schema.
 */
interface QueryProcedure<TInput, TOutput> {
  useQuery: (
    input?: TInput,
    options?: Omit<UseQueryOptions<TOutput, Error>, "queryKey" | "queryFn">
  ) => UseQueryResult<TOutput, Error>;
}

/**
 * Mutation procedure hook interface - only exposes useMutation.
 * Mutations don't take input directly - it's passed to mutate/mutateAsync.
 */
interface MutationProcedure<TInput, TOutput> {
  useMutation: (
    options?: Omit<
      UseMutationOptions<TOutput, Error, TInput>,
      "mutationFn" | "mutationKey"
    >
  ) => UseMutationResult<TOutput, Error, TInput>;
}

/**
 * Maps a contract procedure to the appropriate hook type based on operationType.
 * Extracts input/output types from ContractProcedure's schema types.
 */
type WrappedProcedure<TContractProcedure, _TClientProcedure> =
  TContractProcedure extends ContractProcedure<
    infer TInputSchema,
    infer TOutputSchema,
    infer _TErrors,
    infer TMeta
  >
    ? TMeta extends { operationType: "mutation" }
      ? MutationProcedure<
          InferSchemaInputType<TInputSchema>,
          InferSchemaOutputType<TOutputSchema>
        >
      : QueryProcedure<
          InferSchemaInputType<TInputSchema>,
          InferSchemaOutputType<TOutputSchema>
        >
    : never;

/**
 * Extract input type from Zod schema.
 * Zod schemas have { _input: T } for input inference.
 * Returns empty object when no input schema is defined (unknown input),
 * allowing useQuery({}) calls for parameterless procedures.
 */
type InferSchemaInputType<T> = T extends { _input: infer I }
  ? unknown extends I
    ? Record<string, never>
    : I
  : Record<string, never>;

/**
 * Extract output type from Zod schema.
 * Zod schemas have { _output: T } for output inference.
 */
type InferSchemaOutputType<T> = T extends { _output: infer O } ? O : unknown;

/**
 * Check if a contract type is a procedure (not a nested router).
 */
type IsContractProcedure<T> = T extends ContractProcedure<
  infer _TInput,
  infer _TOutput,
  infer _TErrors,
  infer _TMeta
>
  ? true
  : false;

/**
 * Maps a contract router to wrapped procedures based on operationType.
 * Recursively handles nested routers.
 */
type WrappedClient<TContract extends AnyContractRouter, TClient> = {
  [K in keyof TClient & keyof TContract]: IsContractProcedure<
    TContract[K]
  > extends true
    ? WrappedProcedure<TContract[K], TClient[K]>
    : TClient[K] extends object
    ? TContract[K] extends AnyContractRouter
      ? WrappedClient<TContract[K], TClient[K]>
      : never
    : never;
};

// =============================================================================
// HOOK: usePluginClient
// =============================================================================

/**
 * Access a plugin's RPC client with TanStack Query integration.
 *
 * Each procedure exposes only the appropriate hook based on its operationType:
 * - `operationType: "query"` → `.useQuery(input, options)`
 * - `operationType: "mutation"` → `.useMutation(options)`
 *
 * @example
 * ```tsx
 * const catalog = usePluginClient(CatalogApi);
 *
 * // Queries (only useQuery available)
 * const { data, isLoading } = catalog.getEntities.useQuery({});
 *
 * // Mutations (only useMutation available)
 * const deleteMutation = catalog.deleteSystem.useMutation({
 *   onSuccess: () => toast.success("Deleted!"),
 * });
 *
 * const handleDelete = () => {
 *   deleteMutation.mutate({ systemId });
 * };
 * ```
 */
export function usePluginClient<T extends ClientDefinition>(
  definition: T
): WrappedClient<NonNullable<T["__contractType"]>, InferClient<T>> {
  const orpcUtils = useOrpcUtils();

  const pluginUtils = (orpcUtils as Record<string, unknown>)[
    definition.pluginId
  ] as Record<string, unknown> | undefined;

  if (!pluginUtils) {
    throw new Error(
      `Plugin "${definition.pluginId}" not found. ` +
        `Ensure the plugin is registered and the backend is running.`
    );
  }

  // Get contract for operationType checking
  const contract = definition.contract as Record<string, unknown>;

  return useMemo(() => {
    return wrapPluginUtils(pluginUtils, contract);
  }, [pluginUtils, contract]) as WrappedClient<
    NonNullable<T["__contractType"]>,
    InferClient<T>
  >;
}

// =============================================================================
// WRAPPER IMPLEMENTATION
// =============================================================================

function wrapPluginUtils(
  utils: Record<string, unknown>,
  contract: Record<string, unknown>
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};

  // Iterate over CONTRACT keys (procedure names like "getTheme", "getSystems")
  // not the internal oRPC utility methods ("key", "call", "queryOptions" etc.)
  for (const key of Object.keys(contract)) {
    // Skip oRPC internal metadata keys
    if (key.startsWith("~")) continue;

    const procedureUtils = utils[key] as
      | ProcedureUtils<ClientContext, unknown, unknown, Error>
      | Record<string, unknown>
      | undefined;

    const contractProcedure = contract[key] as
      | Record<string, unknown>
      | undefined;

    if (!procedureUtils || typeof procedureUtils !== "object") {
      // Procedure might not be available in utils
      continue;
    }

    // Check if this is a procedure (has queryOptions or mutationOptions method)
    if (
      typeof (
        procedureUtils as ProcedureUtils<ClientContext, unknown, unknown, Error>
      ).queryOptions === "function" ||
      typeof (
        procedureUtils as ProcedureUtils<ClientContext, unknown, unknown, Error>
      ).mutationOptions === "function"
    ) {
      // Get operationType from contract metadata
      const operationType = getOperationType(contractProcedure, key);
      wrapped[key] = createProcedureHook(
        procedureUtils as ProcedureUtils<
          ClientContext,
          unknown,
          unknown,
          Error
        >,
        operationType
      );
    } else {
      // Nested namespace - recurse
      wrapped[key] = wrapPluginUtils(
        procedureUtils as Record<string, unknown>,
        (contractProcedure || {}) as Record<string, unknown>
      );
    }
  }

  return wrapped;
}

/**
 * Extract operationType from contract procedure metadata.
 * Throws if operationType is not defined (required in all contracts).
 */
function getOperationType(
  contractProcedure: Record<string, unknown> | undefined,
  procedureName?: string
): "query" | "mutation" {
  const orpcMeta = contractProcedure?.["~orpc"] as
    | { meta?: { operationType?: "query" | "mutation" } }
    | undefined;

  const operationType = orpcMeta?.meta?.operationType;

  if (!operationType) {
    throw new Error(
      `Procedure ${
        procedureName ? `"${procedureName}" ` : ""
      }is missing required "operationType" in contract metadata. ` +
        `Add operationType: "query" or operationType: "mutation" to the procedure's .meta() call.`
    );
  }

  return operationType;
}

/**
 * Creates the appropriate hook wrapper based on operationType.
 */
function createProcedureHook<TInput, TOutput>(
  proc: ProcedureUtils<ClientContext, TInput, TOutput, Error>,
  operationType: "query" | "mutation"
): QueryProcedure<TInput, TOutput> | MutationProcedure<TInput, TOutput> {
  if (operationType === "mutation") {
    return {
      useMutation: (options) => {
        const mutationOpts = proc.mutationOptions(options);
        return useMutation(mutationOpts);
      },
    };
  }

  return {
    useQuery: (input, options) => {
      // Get base query options from oRPC
      const queryOpts = proc.queryOptions({
        input: input as TInput,
      });
      // Spread caller options AFTER to ensure they take precedence (e.g., enabled: false)
      return useQuery({ ...queryOpts, ...options });
    },
  };
}
