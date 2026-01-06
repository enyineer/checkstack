import { createSignal } from "@checkmate-monitor/signal-common";
import { z } from "zod";
import { DeliveryStatusSchema } from "./schemas";

/**
 * Signal emitted when a delivery completes (success or failure).
 * Used to update the delivery logs UI in real-time.
 */
export const INTEGRATION_DELIVERY_COMPLETED = createSignal(
  "INTEGRATION_DELIVERY_COMPLETED",
  z.object({
    logId: z.string(),
    subscriptionId: z.string(),
    eventType: z.string(),
    status: DeliveryStatusSchema,
    externalId: z.string().optional(),
    errorMessage: z.string().optional(),
  })
);

/**
 * Signal emitted when a subscription is created, updated, or deleted.
 * Used to refresh the subscriptions list in real-time.
 */
export const INTEGRATION_SUBSCRIPTION_CHANGED = createSignal(
  "INTEGRATION_SUBSCRIPTION_CHANGED",
  z.object({
    action: z.enum(["created", "updated", "deleted"]),
    subscriptionId: z.string(),
  })
);
