/**
 * Notification triggers + actions registered with the Automation Platform.
 *
 * Triggers expose the new `notificationHooks.delivered` and
 * `notificationHooks.failed` events as automation entry points. The
 * hooks are fired from the shared `dispatchWithAttempt` funnel so every
 * external delivery path (subscription fan-out, transactional send,
 * future fan-outs) surfaces uniformly.
 *
 * The `notification.send` action wraps the existing `sendTransactional`
 * RPC — that endpoint is already `userType: "service"`, so the
 * dispatch engine's rpcClient can invoke it directly. Centralising on
 * `sendTransactional` means automation-driven sends honour the same
 * per-user strategy preferences + contact resolution as code-driven
 * ones.
 */
import { z } from "zod";
import { Versioned, type RpcClient } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import { extractErrorMessage } from "@checkstack/common";
import { NotificationApi } from "@checkstack/notification-common";

import { notificationHooks } from "./hooks";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

const deliveredPayloadSchema = z.object({
  notificationId: z.string(),
  strategyQualifiedId: z.string(),
  durationMs: z.number(),
  timestamp: z.string(),
});

const failedPayloadSchema = z.object({
  notificationId: z.string(),
  strategyQualifiedId: z.string(),
  errorMessage: z.string(),
  durationMs: z.number(),
  timestamp: z.string(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

export const notificationDeliveredTrigger: TriggerDefinition<
  z.infer<typeof deliveredPayloadSchema>
> = {
  id: "delivered",
  displayName: "Notification Delivered",
  description: "Fires when an external delivery attempt succeeded",
  category: "Notifications",
  icon: "BellRing",
  payloadSchema: deliveredPayloadSchema,
  hook: notificationHooks.delivered,
  contextKey: (p) => p.notificationId,
};

export const notificationFailedTrigger: TriggerDefinition<
  z.infer<typeof failedPayloadSchema>
> = {
  id: "failed",
  displayName: "Notification Failed",
  description: "Fires when an external delivery attempt failed",
  category: "Notifications",
  icon: "BellOff",
  payloadSchema: failedPayloadSchema,
  hook: notificationHooks.failed,
  contextKey: (p) => p.notificationId,
};

export const notificationTriggers: TriggerDefinition<unknown>[] = [
  notificationDeliveredTrigger as TriggerDefinition<unknown>,
  notificationFailedTrigger as TriggerDefinition<unknown>,
];

// ─── Action: notification.send ─────────────────────────────────────────

const notificationSendConfigSchema = z.object({
  userId: z.string().min(1).describe("Target user to notify"),
  title: z.string().min(1).describe("Notification title"),
  body: z.string().min(1).describe("Notification body (supports markdown)"),
  importance: z
    .enum(["info", "warning", "critical"])
    .optional()
    .describe("Severity; defaults to 'info'"),
  actionLabel: z
    .string()
    .optional()
    .describe("Optional action button label"),
  actionUrl: z
    .string()
    .optional()
    .describe("Optional action button URL"),
});

export type NotificationSendConfig = z.infer<
  typeof notificationSendConfigSchema
>;

// ─── Artifact type ─────────────────────────────────────────────────────

const notificationSendArtifactSchema = z.object({
  userId: z.string(),
  deliveredCount: z
    .number()
    .describe("Number of strategies that delivered successfully"),
  results: z.array(
    z.object({
      strategyId: z.string(),
      success: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});

export type NotificationSendArtifact = z.infer<
  typeof notificationSendArtifactSchema
>;

export const notificationSendArtifactType = {
  id: "send_result",
  displayName: "Notification Send Result",
  description:
    "Per-strategy outcome from a `notification.send` automation action",
  schema: notificationSendArtifactSchema,
} as const;

// ─── Action factory ────────────────────────────────────────────────────

export interface NotificationActionDeps {
  /**
   * Plugin rpcClient. The action invokes
   * `sendTransactional` (service-mode) so notification-backend's
   * existing dispatch loop runs — same strategy fan-out + per-attempt
   * persistence + (now) delivered/failed hook emission as a
   * code-driven send.
   */
  rpcClient: RpcClient;
}

export function createNotificationActions(
  deps: NotificationActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const sendAction: ActionDefinition<
    NotificationSendConfig,
    NotificationSendArtifact
  > = {
    id: "send",
    displayName: "Send Notification",
    description:
      "Send a transactional notification to a specific user via all enabled strategies",
    category: "Notifications",
    icon: "BellRing",
    config: new Versioned({
      version: 1,
      schema: notificationSendConfigSchema,
    }),
    produces: "notification.send_result",
    execute: async ({ config, logger }) => {
      const notificationClient = deps.rpcClient.forPlugin(NotificationApi);
      const action =
        config.actionLabel && config.actionUrl
          ? { label: config.actionLabel, url: config.actionUrl }
          : undefined;
      try {
        const result = await notificationClient.sendTransactional({
          userId: config.userId,
          notification: {
            title: config.title,
            body: config.body,
            importance: config.importance,
            action,
          },
        });
        logger.info(
          `Automation sent notification to ${config.userId} (${result.deliveredCount} delivered)`,
        );
        return {
          success: result.deliveredCount > 0,
          // No single externalId — but recording the user keeps the
          // run-detail UI useful when there are several send steps.
          externalId: config.userId,
          artifact: {
            userId: config.userId,
            deliveredCount: result.deliveredCount,
            results: result.results,
          },
        };
      } catch (error) {
        const message = extractErrorMessage(error);
        logger.error(`Notification send failed: ${message}`);
        return { success: false, error: message };
      }
    },
  };

  return [sendAction as ActionDefinition<unknown, unknown>];
}
