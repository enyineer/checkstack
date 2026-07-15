import { createSlot } from "@checkstack/frontend-api";

/**
 * Slot for a source type to replace the schema-driven config form with a
 * bespoke editor. The generic editor renders DynamicForm from the type's
 * serialized config schema; a filler whose METADATA `sourceTypeId` matches the
 * instance's source type takes over the config section instead (the host
 * filters fillers by metadata, so unrelated fillers are never mounted).
 *
 * Every context VALUE must be referentially stable across renders
 * (`ExtensionSlot` memoizes fillers on shallow context equality - see
 * `.claude/rules/performance.md`): wrap `onConfigChange` in `useCallback` and
 * `config` in state/`useMemo` at the call site.
 *
 * @example
 * // In a source plugin's frontend
 * extensions: [{
 *   id: "my-plugin.cloudwatch-config",
 *   slotId: SourceConfigSlot.id,
 *   metadata: { sourceTypeId: "my-plugin.cloudwatch" },
 *   component: ({ config, onConfigChange, disabled }) => (
 *     <CloudwatchConfigEditor value={config} onChange={onConfigChange} disabled={disabled} />
 *   ),
 * }]
 */
export const SourceConfigSlot = createSlot<
  {
    /** Qualified source type id of the instance being edited. */
    sourceTypeId: string;
    config: Record<string, unknown>;
    onConfigChange: (config: Record<string, unknown>) => void;
    disabled?: boolean;
  },
  {
    /** Qualified source type id this bespoke editor implements. */
    sourceTypeId: string;
  }
>("plugin.telemetry.source-config");
