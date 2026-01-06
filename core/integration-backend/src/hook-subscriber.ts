import type {
  Logger,
  HookSubscribeOptions,
} from "@checkmate-monitor/backend-api";
import type { IntegrationEventRegistry } from "./event-registry";
import type { DeliveryCoordinator } from "./delivery-coordinator";
import type { RegisteredIntegrationEvent } from "@checkmate-monitor/integration-common";

/**
 * Hook subscription function type (matches env.onHook signature)
 */
type OnHookFn = <T>(
  hook: { id: string; _type?: T },
  listener: (payload: T) => Promise<void>,
  options?: HookSubscribeOptions
) => () => Promise<void>;

/**
 * Subscribe to all registered integration events.
 *
 * This function is called during afterPluginsReady to set up hook listeners
 * for each registered integration event. It uses work-queue mode to ensure
 * that only ONE backend instance processes each event (important for horizontal scaling).
 *
 * @param onHook - The onHook function from the plugin environment
 * @param eventRegistry - The registry of integration events
 * @param deliveryCoordinator - The coordinator that routes events to subscriptions
 * @param logger - Logger for debugging
 */
export function subscribeToRegisteredEvents({
  onHook,
  eventRegistry,
  deliveryCoordinator,
  logger,
}: {
  onHook: OnHookFn;
  eventRegistry: IntegrationEventRegistry;
  deliveryCoordinator: DeliveryCoordinator;
  logger: Logger;
}): void {
  const events = eventRegistry.getEvents();

  logger.debug(`Subscribing to ${events.length} integration events...`);

  for (const event of events) {
    subscribeToEvent(event, onHook, deliveryCoordinator, logger);
  }

  logger.info(
    `Subscribed to ${events.length} integration events for webhook delivery`
  );
}

/**
 * Subscribe to a single integration event
 */
function subscribeToEvent(
  event: RegisteredIntegrationEvent,
  onHook: OnHookFn,
  deliveryCoordinator: DeliveryCoordinator,
  logger: Logger
): void {
  // Create a unique worker group for this event
  // This ensures competing consumer behavior across instances
  const workerGroup = `webhook-${event.eventId}`;

  onHook(
    event.hook,
    async (payload: unknown) => {
      logger.debug(`Received integration event: ${event.eventId}`);

      try {
        // Apply optional payload transformation
        const transformedPayload = event.transformPayload
          ? event.transformPayload(payload)
          : (payload as Record<string, unknown>);

        // Route to matching subscriptions
        await deliveryCoordinator.routeEvent({
          eventId: event.eventId,
          payload: transformedPayload,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(
          `Failed to route integration event ${event.eventId}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Don't re-throw - we don't want to fail the entire hook chain
        // The event will be logged but not retried at the hook level
      }
    },
    {
      // CRITICAL: Use work-queue mode to ensure only ONE instance processes each event
      // This prevents duplicate webhook deliveries when horizontally scaled
      mode: "work-queue",
      workerGroup,
    }
  );

  logger.debug(
    `Subscribed to event: ${event.eventId} (workerGroup: ${workerGroup})`
  );
}
