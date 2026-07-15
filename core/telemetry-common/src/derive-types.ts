import { pluginMetadata } from "./plugin-metadata";

/**
 * Ids of the telemetry platform's OWN built-in DERIVE source types.
 *
 * The platform registers these types in its backend, and the frontend contributes
 * a bespoke `SourceConfigSlot` editor keyed on the SAME qualified id. Keeping the
 * ids here in `*-common` is the single source of truth for both sides, so a
 * frontend filler can never drift from the backend type it edits (the same
 * discipline the resource-type keying uses - see `.claude/rules/rlac.md`).
 *
 * The LOCAL ids are what the backend `defineTelemetrySourceType({ id })` declares;
 * the QUALIFIED ids are `${pluginId}.${localId}` - what the source registry stores
 * and what a `SourceConfigSlot` filler's `metadata.sourceTypeId` must equal.
 */

export const LOG_TO_METRIC_LOCAL_ID = "log-to-metric";
export const LOG_TO_TRACE_LOCAL_ID = "log-to-trace";

export const LOG_TO_METRIC_SOURCE_TYPE_ID = `${pluginMetadata.pluginId}.${LOG_TO_METRIC_LOCAL_ID}`;
export const LOG_TO_TRACE_SOURCE_TYPE_ID = `${pluginMetadata.pluginId}.${LOG_TO_TRACE_LOCAL_ID}`;
