/**
 * A type-safe slot definition that can be exported from plugin common packages.
 * The context type parameter defines what props extensions will receive.
 */
export interface SlotDefinition<TContext = undefined> {
  /** Unique slot identifier, recommended format: "plugin-name.area.purpose" */
  readonly id: string;
  /** Phantom type for context type inference - do not use directly */
  readonly _contextType?: TContext;
}

/**
 * Creates a type-safe slot definition that can be exported from any package.
 *
 * @example
 * // In @checkmate/catalog-common
 * export const SystemDetailsSlot = createSlot<{ systemId: string }>(
 *   "catalog.system.details"
 * );
 *
 * // In your frontend plugin
 * extensions: [{
 *   id: "my-plugin.system-details",
 *   slot: SystemDetailsSlot,
 *   component: MySystemDetailsExtension, // Receives { systemId: string }
 * }]
 *
 * @param id - Unique slot identifier
 * @returns A slot definition that can be used for type-safe extension registration
 */
export function createSlot<TContext = undefined>(
  id: string
): SlotDefinition<TContext> {
  return { id } as SlotDefinition<TContext>;
}
