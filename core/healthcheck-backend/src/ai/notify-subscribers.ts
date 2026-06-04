/**
 * AI tools to notify the subscribers of a system or system group under the
 * health-status subscription specs this plugin owns.
 *
 * These are hand-authored `mutate` tools. They call
 * `notification.notifyForSubscription` through the call-time `rpcClient`
 * (user-scoped in chat; the automation's `runAs` service account in the AI
 * action), so the caller must hold `notification.send`. The notification
 * backend enforces that rule for non-service callers and validates the
 * resource keys, so a tool can only reach real subscribers.
 */
import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient } from "@checkstack/backend-api";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import type { AiProposalPreview } from "@checkstack/ai-common";
import {
  NotificationApi,
  notificationAccess,
  pluginMetadata as notificationPluginMetadata,
} from "@checkstack/notification-common";
import {
  createSystemSubject,
  createGroupSubject,
} from "@checkstack/catalog-common";
import {
  healthcheckSystemSubscription,
  healthcheckGroupSubscription,
} from "@checkstack/healthcheck-common";

const NOTIFICATION_SEND_RULE = qualifyAccessRuleId(
  notificationPluginMetadata,
  notificationAccess.send,
);

const baseInputShape = {
  title: z.string().min(1).describe("Notification title"),
  body: z.string().min(1).describe("Notification body (supports markdown)"),
  importance: z
    .enum(["info", "warning", "critical"])
    .optional()
    .describe("Severity; defaults to 'info'"),
  actionLabel: z.string().optional().describe("Optional action button label"),
  actionUrl: z.string().optional().describe("Optional action button URL"),
};

const NotifySystemSubscribersInputSchema = z.object({
  systemId: z.string().min(1).describe("Id of the system whose subscribers to notify"),
  systemName: z
    .string()
    .optional()
    .describe("Display name of the system (falls back to the id)"),
  ...baseInputShape,
});
export type NotifySystemSubscribersInput = z.infer<
  typeof NotifySystemSubscribersInputSchema
>;

const NotifyGroupSubscribersInputSchema = z.object({
  groupId: z.string().min(1).describe("Id of the system group whose subscribers to notify"),
  groupName: z
    .string()
    .optional()
    .describe("Display name of the group (falls back to the id)"),
  ...baseInputShape,
});
export type NotifyGroupSubscribersInput = z.infer<
  typeof NotifyGroupSubscribersInputSchema
>;

export interface NotifyResult {
  notifiedCount: number;
}

function actionFrom(input: {
  actionLabel?: string;
  actionUrl?: string;
}): { label: string; url: string } | undefined {
  return input.actionLabel && input.actionUrl
    ? { label: input.actionLabel, url: input.actionUrl }
    : undefined;
}

/**
 * `healthcheck.notifySystemSubscribers` - notify everyone subscribed to a
 * system's health status.
 */
export function createNotifySystemSubscribersTool(): RegisteredAiTool<
  NotifySystemSubscribersInput,
  NotifyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: NotifySystemSubscribersInput;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<NotifySystemSubscribersInput>> => ({
    summary: `Notify subscribers of system "${input.systemName ?? input.systemId}": ${input.title}`,
    payload: input,
  });

  return {
    name: "healthcheck.notifySystemSubscribers",
    description:
      "Notify everyone subscribed to a system's health status. Requires confirmation before it sends (unless in auto mode). Provide the system id (and ideally its name).",
    effect: "mutate",
    input: NotifySystemSubscribersInputSchema,
    requiredAccessRules: [NOTIFICATION_SEND_RULE],
    dryRun,
    async execute({ input, rpcClient }) {
      const result = await rpcClient.forPlugin(NotificationApi).notifyForSubscription({
        specId: healthcheckSystemSubscription.specId,
        resourceKeys: [input.systemId],
        title: input.title,
        body: input.body,
        importance: input.importance,
        action: actionFrom(input),
        subjects: [
          createSystemSubject({
            id: input.systemId,
            name: input.systemName ?? input.systemId,
            url: input.actionUrl,
          }),
        ],
      });
      return { notifiedCount: result.notifiedCount };
    },
  };
}

/**
 * `healthcheck.notifySystemGroupSubscribers` - notify everyone subscribed to a
 * system group's health status.
 */
export function createNotifySystemGroupSubscribersTool(): RegisteredAiTool<
  NotifyGroupSubscribersInput,
  NotifyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: NotifyGroupSubscribersInput;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<NotifyGroupSubscribersInput>> => ({
    summary: `Notify subscribers of system group "${input.groupName ?? input.groupId}": ${input.title}`,
    payload: input,
  });

  return {
    name: "healthcheck.notifySystemGroupSubscribers",
    description:
      "Notify everyone subscribed to a system group's health status. Requires confirmation before it sends (unless in auto mode). Provide the group id (and ideally its name).",
    effect: "mutate",
    input: NotifyGroupSubscribersInputSchema,
    requiredAccessRules: [NOTIFICATION_SEND_RULE],
    dryRun,
    async execute({ input, rpcClient }) {
      const result = await rpcClient.forPlugin(NotificationApi).notifyForSubscription({
        specId: healthcheckGroupSubscription.specId,
        resourceKeys: [input.groupId],
        title: input.title,
        body: input.body,
        importance: input.importance,
        action: actionFrom(input),
        subjects: [
          createGroupSubject({
            id: input.groupId,
            name: input.groupName ?? input.groupId,
            url: input.actionUrl,
          }),
        ],
      });
      return { notifiedCount: result.notifiedCount };
    },
  };
}
