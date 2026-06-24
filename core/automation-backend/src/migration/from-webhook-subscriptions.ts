/**
 * One-time migration from the legacy `webhook_subscriptions` table to
 * automations.
 *
 * Strategy:
 *   1. Pull the legacy rows via `IntegrationApi.listLegacySubscriptions`
 *      (the only cross-plugin path — the table lives in another
 *      plugin's schema and `SafeDatabase` blocks direct queries).
 *   2. For each row, build a single-trigger / single-action automation
 *      and INSERT it with `managed_by = "migrated-subscription:<id>"`.
 *   3. Skip rows whose `managed_by` automation already exists — that
 *      makes the migration idempotent across restarts.
 *   4. Any row that doesn't translate cleanly is recorded in
 *      `automation_migration_failures` so an admin can fix it via the
 *      RPC + UI.
 *
 * The migration runs on `afterPluginsReady` so the integration RPC is
 * ready and all triggers/actions have been registered.
 */
import { eq } from "drizzle-orm";
import type {
  Logger,
  SafeDatabase,
  RpcClient,
} from "@checkstack/backend-api";
import { IntegrationApi } from "@checkstack/integration-common";
import {
  AutomationDefinitionSchema,
  type AutomationDefinition,
  type ConditionInput,
} from "@checkstack/automation-common";
import { extractErrorMessage } from "@checkstack/common";

import * as schema from "../schema";

type Db = SafeDatabase<typeof schema>;

export interface LegacySubscription {
  id: string;
  name: string;
  description?: string;
  providerId: string;
  providerConfig: Record<string, unknown>;
  eventId: string;
  systemFilter?: string[];
  enabled: boolean;
}

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
}

interface MigrationFailureRecord {
  subscriptionId: string;
  subscriptionName: string;
  providerId: string;
  eventId: string;
  reason: string;
  detail?: string;
  providerConfig: Record<string, unknown>;
}

/**
 * Map a legacy `providerId` to the qualified id of the action that
 * replaces it on the Automation Platform. Returns `undefined` when no
 * known mapping exists (the row goes into the failure log).
 */
function resolveActionId(providerId: string): string | undefined {
  switch (providerId) {
    case "integration-jira.jira": {
      return "integration-jira.create_issue";
    }
    case "integration-teams.teams": {
      return "integration-teams.post_message";
    }
    case "integration-webex.webex": {
      return "integration-webex.post_message";
    }
    case "integration-webhook.webhook": {
      return "integration-webhook.send";
    }
    case "integration-script.script": {
      return "integration-script.run_script";
    }
    case "integration-script.shell": {
      return "integration-script.run_shell";
    }
    default: {
      return;
    }
  }
}

/**
 * Translate a legacy `providerConfig` to the new action's config
 * shape. Returns `{ ok: false }` for known providers whose config
 * can't be translated (e.g. required fields missing).
 */
function translateProviderConfig(
  providerId: string,
  providerConfig: Record<string, unknown>,
): { ok: true; config: Record<string, unknown> } | { ok: false; reason: string } {
  switch (providerId) {
    case "integration-jira.jira": {
      const fieldMappings = Array.isArray(providerConfig.fieldMappings)
        ? (providerConfig.fieldMappings as Array<Record<string, unknown>>).map(
            (mapping) => ({
              fieldKey: String(mapping.fieldKey ?? ""),
              value: String(mapping.template ?? ""),
            }),
          )
        : undefined;
      return {
        ok: true,
        config: {
          connectionId: providerConfig.connectionId,
          projectKey: providerConfig.projectKey,
          issueTypeId: providerConfig.issueTypeId,
          summary: providerConfig.summaryTemplate,
          description: providerConfig.descriptionTemplate,
          priorityId: providerConfig.priorityId,
          fieldMappings,
        },
      };
    }
    case "integration-teams.teams": {
      // The legacy provider auto-generated an adaptive card from the
      // event payload. The new action requires a `body` — generate a
      // sensible default that dumps the trigger payload so existing
      // subscriptions keep working until the operator edits the
      // template.
      return {
        ok: true,
        config: {
          connectionId: providerConfig.connectionId,
          teamId: providerConfig.teamId,
          channelId: providerConfig.channelId,
          title: "Automation event",
          body: "Event: {{ trigger.event }}\n\nPayload:\n```json\n{{ trigger.payload | json(2) }}\n```",
        },
      };
    }
    case "integration-webex.webex": {
      const markdown =
        typeof providerConfig.messageTemplate === "string" &&
        providerConfig.messageTemplate.length > 0
          ? providerConfig.messageTemplate
          : "**Automation event**\n\nEvent: {{ trigger.event }}\n\n```json\n{{ trigger.payload | json(2) }}\n```";
      return {
        ok: true,
        config: {
          connectionId: providerConfig.connectionId,
          roomId: providerConfig.roomId,
          markdown,
        },
      };
    }
    case "integration-webhook.webhook": {
      // The webhook config is 1:1 — only renames the body field.
      const { bodyTemplate, ...rest } = providerConfig;
      return {
        ok: true,
        config: {
          ...rest,
          body: bodyTemplate,
        },
      };
    }
    case "integration-script.script": {
      // Legacy TS-script provider config was `{ script, timeout }`;
      // workingDirectory / env never applied to the subprocess runner.
      return {
        ok: true,
        config: {
          script: providerConfig.script,
          timeout: providerConfig.timeout,
        },
      };
    }
    case "integration-script.shell": {
      // Legacy shell provider exposed script + timeout + workingDirectory.
      // The auto-flattened `PAYLOAD_*` env vars are gone — operators now
      // reference template values directly in the script body.
      return {
        ok: true,
        config: {
          script: providerConfig.script,
          timeout: providerConfig.timeout,
          workingDirectory: providerConfig.workingDirectory,
        },
      };
    }
    default: {
      return { ok: false, reason: `unknown provider ${providerId}` };
    }
  }
}

/**
 * Build a top-level condition that gates the automation on the
 * subscription's `systemFilter`. Empty filter → no condition.
 */
function buildSystemFilterCondition(
  systemFilter: string[] | undefined,
): ConditionInput[] {
  if (!systemFilter || systemFilter.length === 0) return [];
  // Conditions are BARE expressions (no {{ }} — that is template syntax and
  // fails to parse at dispatch time).
  const branches = systemFilter.map(
    (systemId) => `trigger.payload.systemId == "${systemId}"`,
  );
  if (branches.length === 1) return [branches[0]!];
  return [{ or: branches }];
}

/**
 * Translate one legacy subscription to an `AutomationDefinition`.
 *
 * Exported so the per-provider mapping rules can be tested in
 * isolation without standing up a database + rpcClient.
 */
export function buildDefinitionFor(
  sub: LegacySubscription,
):
  | { ok: true; definition: AutomationDefinition; actionId: string }
  | { ok: false; reason: string; detail?: string } {
  const actionId = resolveActionId(sub.providerId);
  if (!actionId) {
    return {
      ok: false,
      reason: `unsupported provider`,
      detail: `No automation action is registered for provider ${sub.providerId}`,
    };
  }
  const translated = translateProviderConfig(sub.providerId, sub.providerConfig);
  if (!translated.ok) {
    return { ok: false, reason: translated.reason };
  }
  // Round-trip through the schema's `parse` to fill in defaults (Zod
  // strict-output forces `enabled` / `continue_on_error` etc.). Using
  // the input shape here avoids re-listing every base-action default.
  const draft = {
    name: sub.name,
    description: sub.description,
    triggers: [{ event: sub.eventId }],
    conditions: buildSystemFilterCondition(sub.systemFilter),
    actions: [
      {
        action: actionId,
        config: translated.config,
      },
    ],
    mode: "single",
    max_runs: 10,
  };
  const parsed = AutomationDefinitionSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "definition validation failed",
      detail: parsed.error.message,
    };
  }
  return { ok: true, definition: parsed.data, actionId };
}

export interface RunMigrationArgs {
  db: Db;
  rpcClient: RpcClient;
  logger: Logger;
}

/**
 * Run the migration once. Idempotent — already-migrated subscriptions
 * are detected via the `managed_by = "migrated-subscription:<id>"`
 * marker on the automation row.
 */
export async function runWebhookSubscriptionMigration(
  args: RunMigrationArgs,
): Promise<MigrationResult> {
  const { db, rpcClient, logger } = args;
  const integrationClient = rpcClient.forPlugin(IntegrationApi);

  let subscriptions: LegacySubscription[];
  try {
    subscriptions = await integrationClient.listLegacySubscriptions();
  } catch (error) {
    logger.warn(
      `migration: legacy subscription endpoint not reachable — skipping (${extractErrorMessage(error, "unknown error")})`,
    );
    return { total: 0, migrated: 0, skipped: 0, failed: 0 };
  }

  if (subscriptions.length === 0) {
    logger.debug("migration: no legacy subscriptions to migrate");
    return { total: 0, migrated: 0, skipped: 0, failed: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  const failures: MigrationFailureRecord[] = [];

  for (const sub of subscriptions) {
    const managedBy = `migrated-subscription:${sub.id}`;
    const existing = await db
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(eq(schema.automations.managedBy, managedBy))
      .limit(1);
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }

    const built = buildDefinitionFor(sub);
    if (!built.ok) {
      failures.push({
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        providerId: sub.providerId,
        eventId: sub.eventId,
        reason: built.reason,
        detail: built.detail,
        providerConfig: sub.providerConfig,
      });
      continue;
    }

    try {
      await db.insert(schema.automations).values({
        name: sub.name,
        description: sub.description ?? null,
        status: sub.enabled ? "enabled" : "disabled",
        definition: built.definition as unknown as Record<string, unknown>,
        managedBy,
      });
      migrated += 1;
      logger.info(
        `migration: migrated subscription ${sub.id} → automation (${sub.name})`,
      );
    } catch (error) {
      const detail = extractErrorMessage(error, "insert failed");
      failures.push({
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        providerId: sub.providerId,
        eventId: sub.eventId,
        reason: "insert failed",
        detail,
        providerConfig: sub.providerConfig,
      });
    }
  }

  // Record failures so the admin RPC + UI can surface them.
  for (const failure of failures) {
    try {
      await db
        .insert(schema.automationMigrationFailures)
        .values({
          subscriptionId: failure.subscriptionId,
          subscriptionName: failure.subscriptionName,
          providerId: failure.providerId,
          eventId: failure.eventId,
          reason: failure.reason,
          detail: failure.detail ?? null,
          providerConfig: failure.providerConfig,
        })
        .onConflictDoUpdate({
          target: schema.automationMigrationFailures.subscriptionId,
          set: {
            subscriptionName: failure.subscriptionName,
            providerId: failure.providerId,
            eventId: failure.eventId,
            reason: failure.reason,
            detail: failure.detail ?? null,
            providerConfig: failure.providerConfig,
          },
        });
    } catch (error) {
      logger.error(
        `migration: could not record failure for subscription ${failure.subscriptionId}: ${extractErrorMessage(error, "unknown error")}`,
      );
    }
  }

  const result: MigrationResult = {
    total: subscriptions.length,
    migrated,
    skipped,
    failed: failures.length,
  };
  logger.info(
    `migration: complete — total=${result.total} migrated=${result.migrated} skipped=${result.skipped} failed=${result.failed}`,
  );
  return result;
}
