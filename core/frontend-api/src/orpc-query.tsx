import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createRouterUtils,
  type RouterUtils,
  type ProcedureUtils,
} from "@orpc/tanstack-query";
import type { NestedClient, ClientContext } from "@orpc/client";
import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

export { useQueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "./api-context";
import { rpcApiRef, accessApiRef } from "./core-apis";
import type {
  ClientDefinition,
  InferClient,
  ProcedureWithMeta,
} from "@checkstack/common";
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
        "Wrap your app with <OrpcQueryProvider>.",
    );
  }
  return context;
}

// =============================================================================
// TYPE HELPERS FOR STRICT operationType INFERENCE
// =============================================================================

/**
 * The authorization verdict a gated hook fuses onto its query/mutation result.
 * Derived from the SAME contract procedure and input the call uses, so it can
 * never drift from what the backend will enforce.
 */
export interface GateVerdict {
  /** Whether the caller is authorized for this exact call. */
  allowed: boolean;
  /** Whether the authorization verdict is still resolving. */
  accessLoading: boolean;
}

/**
 * Whether a gate-fused query should actually fire. A gated query must NEVER
 * issue a call the caller is not authorized for (a guaranteed 403), so it fires
 * ONLY when the caller did not disable it AND the gate resolved to `allowed`.
 * `gateAllowed` is `false` while the verdict is still resolving, so this also
 * holds the fetch until authorization is known. Extracted as a pure function so
 * the guaranteed-403 guard is unit-testable without a DOM/query harness.
 *
 * `callerEnabled` is typed `unknown` because TanStack's `enabled` option may be
 * `boolean`, `undefined`, or the `(query) => boolean` functional form. Only an
 * explicit `true` (or an unset value defaulting to `true`) fires the query; any
 * other value - including the functional form - holds it, matching the prior
 * inline `(enabled ?? true) === true` semantics exactly.
 */
export function gatedQueryEnabled({
  callerEnabled,
  gateAllowed,
}: {
  callerEnabled: unknown;
  gateAllowed: boolean;
}): boolean {
  return (callerEnabled ?? true) === true && gateAllowed;
}

/**
 * Query procedure hook interface - only exposes useQuery.
 * Input is optional when the procedure has no input schema.
 */
interface QueryProcedure<TInput, TOutput> {
  useQuery: (
    input?: TInput,
    options?: Omit<UseQueryOptions<TOutput, Error>, "queryKey" | "queryFn">,
  ) => UseQueryResult<TOutput, Error>;
  /**
   * Gate-fused query: derives the authorization gate from this procedure's
   * contract + the SAME `input`, keeps the query disabled until the caller is
   * authorized (no guaranteed-403 fetch), and returns the query result with the
   * `{ allowed, accessLoading }` verdict fused on. There is nothing to keep in
   * sync - the gate IS the call.
   */
  useGatedQuery: (
    input?: TInput,
    options?: Omit<UseQueryOptions<TOutput, Error>, "queryKey" | "queryFn">,
  ) => UseQueryResult<TOutput, Error> & GateVerdict;
  /**
   * Imperative one-shot call, outside React Query. Use inside async
   * callbacks that can't host a hook (e.g. a DynamicForm options
   * resolver). Prefer `useQuery` for anything rendered.
   */
  call: (input: TInput) => Promise<TOutput>;
}

/**
 * Mutation procedure hook interface - only exposes useMutation.
 * Mutations don't take input directly - it's passed to mutate/mutateAsync.
 *
 * `TContext` is threaded through the options so optimistic-update sites
 * can return a snapshot from `onMutate` and read it back in `onError`
 * without resorting to `unknown` casts. See
 * `docs/frontend/optimistic-updates.md` for the canonical pattern.
 */
interface MutationProcedure<TInput, TOutput> {
  useMutation: <TContext = unknown>(
    options?: Omit<
      UseMutationOptions<TOutput, Error, TInput, TContext>,
      "mutationFn" | "mutationKey"
    >,
  ) => UseMutationResult<TOutput, Error, TInput, TContext>;
  /**
   * Gate-fused mutation: derives the authorization gate from this procedure's
   * contract and returns the mutation with the `{ allowed, accessLoading }`
   * verdict fused on, so the control that calls `mutate` reads its own
   * enablement from the same object. A mutation's resource id isn't known until
   * `mutate(input)` time, so pass the id-bearing `gateInput` (e.g. `{ id }`,
   * available from the route/row at render) for per-instance (`idParam`) gates;
   * omit it for `create` / `global` gates. You cannot obtain `mutate` without
   * the verdict, so the gate can never be forgotten or drift from the call.
   */
  useGatedMutation: <TContext = unknown>(
    options?: Omit<
      UseMutationOptions<TOutput, Error, TInput, TContext>,
      "mutationFn" | "mutationKey"
    > & {
      /** Id-bearing input for per-instance gates; omit for create/global. */
      gateInput?: Partial<TInput>;
    },
  ) => UseMutationResult<TOutput, Error, TInput, TContext> & GateVerdict;
  /**
   * Imperative one-shot call, outside React Query. Use inside async
   * callbacks that can't host a hook (e.g. a DynamicForm options
   * resolver). Prefer `useMutation` for anything tied to UI lifecycle.
   */
  call: (input: TInput) => Promise<TOutput>;
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
type IsContractProcedure<T> =
  T extends ContractProcedure<
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
  definition: T,
): WrappedClient<NonNullable<T["__contractType"]>, InferClient<T>> {
  const orpcUtils = useOrpcUtils();

  const pluginUtils = (orpcUtils as Record<string, unknown>)[
    definition.pluginId
  ] as Record<string, unknown> | undefined;

  if (!pluginUtils) {
    throw new Error(
      `Plugin "${definition.pluginId}" not found. ` +
        `Ensure the plugin is registered and the backend is running.`,
    );
  }

  // Get contract for operationType checking
  const contract = definition.contract as Record<string, unknown>;

  return useMemo(() => {
    return wrapPluginUtils(pluginUtils, contract, definition.pluginId);
  }, [pluginUtils, contract, definition.pluginId]) as WrappedClient<
    NonNullable<T["__contractType"]>,
    InferClient<T>
  >;
}

// =============================================================================
// WRAPPER IMPLEMENTATION
// =============================================================================

function wrapPluginUtils(
  utils: Record<string, unknown>,
  contract: Record<string, unknown>,
  pluginId: string,
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
        operationType,
        pluginId,
        // The contract procedure carries `~orpc.meta` (access + instanceAccess);
        // the gated hooks derive their authorization gate from it. Cast at this
        // internal boundary mirrors `getOperationType`'s `~orpc` access above.
        contractProcedure as unknown as ProcedureWithMeta,
      );
    } else {
      // Nested namespace - recurse
      wrapped[key] = wrapPluginUtils(
        procedureUtils as Record<string, unknown>,
        (contractProcedure || {}) as Record<string, unknown>,
        pluginId,
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
  procedureName?: string,
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
        `Add operationType: "query" or operationType: "mutation" to the procedure's .meta() call.`,
    );
  }

  return operationType;
}

/**
 * Creates the appropriate hook wrapper based on operationType.
 */
function createProcedureHook<TInput, TOutput>(
  proc: ProcedureUtils<ClientContext, TInput, TOutput, Error>,
  operationType: "query" | "mutation",
  pluginId: string,
  contractProcedure: ProcedureWithMeta,
): QueryProcedure<TInput, TOutput> | MutationProcedure<TInput, TOutput> {
  if (operationType === "mutation") {
    return {
      useMutation: (options) => {
        const queryClient = useQueryClient();
        const mutationOpts = proc.mutationOptions({
          ...options,
          onSuccess: (...args) => {
            // Automatically invalidate all queries for this plugin
            // so every view showing this plugin's data stays fresh.
            // oRPC query keys are [pathArray, options] where pathArray
            // starts with the pluginId, e.g. ["healthcheck", "getConfigurations"].
            void queryClient.invalidateQueries({
              queryKey: [[pluginId]],
            });
            // Call the user-provided onSuccess handler if present
            options?.onSuccess?.(...args);
          },
        });
        // Remove the duplicate onSuccess from the outer options to avoid
        // double-invocation — it's already integrated above.
        const { onSuccess: _, ...restOptions } = options ?? {};
        return useMutation({ ...mutationOpts, ...restOptions });
      },
      useGatedMutation: (options) => {
        // Strip the gate-only field before building the mutation.
        const { gateInput, ...mutationOptions } = options ?? {};
        // Derive the authorization gate from THIS procedure's contract + the
        // id-bearing gateInput. Fused onto the same object as `mutate`, so a
        // control cannot obtain `mutate` without also holding the verdict.
        const accessApi = useApi(accessApiRef);
        const gate = accessApi.useProcedureAccess(contractProcedure, gateInput);
        const queryClient = useQueryClient();
        const mutationOpts = proc.mutationOptions({
          ...mutationOptions,
          onSuccess: (...args) => {
            void queryClient.invalidateQueries({ queryKey: [[pluginId]] });
            mutationOptions.onSuccess?.(...args);
          },
        });
        const { onSuccess: _, ...restOptions } = mutationOptions;
        const mutation = useMutation({ ...mutationOpts, ...restOptions });
        return {
          ...mutation,
          allowed: gate.allowed,
          accessLoading: gate.loading,
        };
      },
      call: (input) => proc.call(input),
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
    useGatedQuery: (input, options) => {
      // The query input IS the gate input — one source for both.
      const accessApi = useApi(accessApiRef);
      const gate = accessApi.useProcedureAccess(contractProcedure, input);
      const queryOpts = proc.queryOptions({ input: input as TInput });
      const query = useQuery({
        ...queryOpts,
        ...options,
        // Never fire a call the caller isn't authorized for (a guaranteed 403).
        // `allowed` is false while the verdict resolves, so this also waits.
        enabled: gatedQueryEnabled({
          callerEnabled: options?.enabled,
          gateAllowed: gate.allowed,
        }),
      });
      return { ...query, allowed: gate.allowed, accessLoading: gate.loading };
    },
    call: (input) => proc.call(input),
  };
}
