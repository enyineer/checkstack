import { createSlot, type RpcApi } from "@checkstack/frontend-api";
import type { OptionsResolver } from "@checkstack/ui";

/**
 * Context handed to a contributed options-resolver factory when the health-check
 * editor builds the `optionsResolvers` map for a strategy's config forms.
 *
 * The editor is the HOST here: it owns the check-editor surface that any plugin
 * can plug a strategy into, and it must stay ignorant of every specific strategy
 * (dependency direction - a domain plugin like `logstream` contributes, the
 * platform editor never imports it). So the editor supplies only GENERIC context
 * and lets the owning plugin turn it into concrete resolvers.
 */
export interface ConfigOptionsResolverContext {
  /**
   * The generic RPC api. A contributor scopes it to its own plugin with
   * `rpcApi.forPlugin(MyApi)` and calls its `typeScoped`/read procedures - no
   * hook needed, so the factory is a plain function the host can invoke while
   * building the resolver map.
   */
  rpcApi: RpcApi;
  /**
   * The CURRENT strategy-config values (opaque to the editor). This is what
   * bridges a collector-field resolver to a selection that lives in the SIBLING
   * strategy form: e.g. the log-stream pattern picker (a collector field) reads
   * the `streamId` the operator chose in the strategy form. The editor holds
   * both forms, so it can pass the strategy config down to the collector form's
   * resolvers; the resolver reads whatever key it owns.
   */
  strategyConfig: Record<string, unknown>;
}

/**
 * Turns the editor's generic context into the `x-options-resolver`-name ->
 * resolver map for one strategy's config + collector forms. Pure and
 * synchronous - the resolvers it returns are the async functions
 * `DynamicForm` calls when a dropdown field mounts.
 */
export type ConfigOptionsResolverFactory = (
  ctx: ConfigOptionsResolverContext,
) => Record<string, OptionsResolver>;

/**
 * Slot metadata a plugin declares to contribute dynamic-dropdown resolvers to
 * the health-check editor for the strategy it owns.
 */
export interface ConfigOptionsResolverMetadata {
  /**
   * The (unqualified) strategy id whose config/collector forms these resolvers
   * serve, e.g. `"logstream"`. The editor only invokes factories whose
   * `strategyId` matches the strategy being edited.
   */
  strategyId: string;
  /** Builds the resolver map from the editor's generic context. */
  buildResolvers: ConfigOptionsResolverFactory;
}

/**
 * Contribution point for health-check-editor dropdown resolvers.
 *
 * A plugin that registers a health-check STRATEGY (via the backend
 * `healthCheckRegistry`) whose config declares `x-options-resolver` fields
 * contributes a matching factory here so those fields render as real dropdowns
 * in the editor instead of plain text inputs. The metadata carries the factory;
 * the extension's `component` is never rendered (the host reads metadata via
 * `useSlotExtensions`), so contributors pass `component: () => null`.
 *
 * This inverts the dependency exactly like the backend extension points: the
 * platform editor DEFINES the point and stays ignorant of any strategy; the
 * owning domain plugin SUPPLIES the resolvers.
 */
export const HealthCheckConfigOptionsResolverSlot = createSlot<
  undefined,
  ConfigOptionsResolverMetadata
>("healthcheck.editor.config-options-resolver");
