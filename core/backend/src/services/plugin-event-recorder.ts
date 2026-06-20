import { desc, eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { PluginSource } from "@checkstack/common";
import type {
  InstallEvent,
  InstallEventAction,
  InstallEventPhase,
  InstallEventStatus,
} from "@checkstack/pluginmanager-common";
import { pluginInstallEvents } from "../schema";

/**
 * Persist install/uninstall lifecycle events.
 *
 * Every step of the install/uninstall flow writes a row here:
 *   - originator: validate / persist / broadcast / destructive-cleanup / audit
 *   - receiving instances: in-process-load / in-process-unload
 *
 * Failures are kept (status="failed") so the admin Events page can surface
 * partial state for manual remediation. The originator dying mid-flight
 * leaves a "started" row that never transitions — the UI flags those.
 */
export class PluginEventRecorder {
  constructor(
    private readonly db: SafeDatabase<Record<string, unknown>>,
    private readonly instanceId: string,
  ) {}

  async record(input: {
    pluginName?: string | null;
    bundleId?: string | null;
    action: InstallEventAction;
    phase: InstallEventPhase;
    status: InstallEventStatus;
    source?: PluginSource | null;
    error?: string | null;
    userId?: string | null;
  }): Promise<void> {
    // Drizzle writes `null` as a real NULL column and `undefined` as
    // "skip this column"; both map to NULL on insert here, but normalize
    // to `null` so the row's shape matches the schema-declared
    // nullable columns.
    await this.db.insert(pluginInstallEvents).values({
      pluginName: input.pluginName ?? null,
      bundleId: input.bundleId ?? null,
      action: input.action,
      phase: input.phase,
      status: input.status,
      source: input.source ?? null,
      error: input.error ?? null,
      instanceId: this.instanceId,
      userId: input.userId ?? null,
    });
  }

  async list(input?: {
    pluginName?: string;
    limit?: number;
  }): Promise<InstallEvent[]> {
    const limit = input?.limit ?? 100;
    const where = input?.pluginName
      ? eq(pluginInstallEvents.pluginName, input.pluginName)
      : undefined;

    const rows = await this.db
      .select()
      .from(pluginInstallEvents)
      .where(where)
      .orderBy(desc(pluginInstallEvents.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      pluginName: row.pluginName,
      bundleId: row.bundleId,
      action: row.action as InstallEventAction,
      phase: row.phase as InstallEventPhase,
      status: row.status as InstallEventStatus,
      source: row.source,
      error: row.error,
      instanceId: row.instanceId,
      userId: row.userId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

}
