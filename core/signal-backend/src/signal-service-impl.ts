import type { EventBus, Logger } from "@checkstack/backend-api";
import { qualifyAccessRuleId } from "@checkstack/common";
import type {
  Signal,
  SignalMessage,
  SignalService,
} from "@checkstack/signal-common";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "./hooks";

/**
 * Interface for the auth client methods needed by SignalService.
 * This is a subset of the AuthApi client to avoid circular dependencies.
 */
interface AuthClientForSignals {
  filterUsersByAccessRule: (input: {
    userIds: string[];
    accessRule: string;
  }) => Promise<string[]>;
}

/**
 * SignalService implementation that uses EventBus for multi-instance coordination.
 *
 * When a signal is emitted, it goes through the EventBus (backed by the queue system),
 * ensuring all backend instances receive it and can push to their local WebSocket clients.
 */
export class SignalServiceImpl implements SignalService {
  private authClient?: AuthClientForSignals;

  constructor(private eventBus: EventBus, private logger: Logger) {}

  /**
   * Set the auth client for access-based signal filtering.
   * This should be called after plugins have loaded.
   */
  setAuthClient(client: AuthClientForSignals): void {
    this.authClient = client;
  }

  /**
   * Real-time signals are BEST-EFFORT, by platform contract. They are a UI
   * convenience (a live push so a client refreshes sooner); the authoritative
   * data is already committed to the database by the time a mutation broadcasts.
   * A transient event-bus/queue failure must therefore NEVER turn a successful,
   * committed write into a client-visible error. Every signal-send routes
   * through here so that guarantee holds for ALL callers - including future
   * plugins - without each call site needing its own try/catch (which would
   * inevitably be forgotten and regress). The mirror of `createCachedScope`,
   * which already makes cache invalidation non-throwing the same way.
   *
   * If a send fails, the client simply misses one live nudge and picks up the
   * (already-persisted) state on its next fetch/refetch.
   */
  private async safeSend(
    description: string,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(
        `Signal delivery failed (${description}) - the write succeeded; clients will reconcile on next fetch.`,
        { error },
      );
    }
  }

  async broadcast<T>(signal: Signal<T>, payload: T): Promise<void> {
    const message: SignalMessage<T> = {
      signalId: signal.id,
      pluginId: signal.pluginId,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(`Broadcasting signal: ${signal.id}`);

    // Emit to EventBus - all backend instances receive and push to their WebSocket clients
    await this.safeSend(`broadcast ${signal.id}`, () =>
      this.eventBus.emit(SIGNAL_BROADCAST_HOOK, message),
    );
  }

  async sendToUser<T>(
    signal: Signal<T>,
    userId: string,
    payload: T
  ): Promise<void> {
    const message: SignalMessage<T> = {
      signalId: signal.id,
      pluginId: signal.pluginId,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(`Sending signal ${signal.id} to user ${userId}`);

    await this.safeSend(`${signal.id} -> user ${userId}`, () =>
      this.eventBus.emit(SIGNAL_USER_HOOK, { userId, message }),
    );
  }

  async sendToUsers<T>(
    signal: Signal<T>,
    userIds: string[],
    payload: T
  ): Promise<void> {
    await Promise.all(
      userIds.map((userId) => this.sendToUser(signal, userId, payload))
    );
  }

  async sendToAuthorizedUsers<T>(
    signal: Signal<T>,
    userIds: string[],
    payload: T,
    pluginMetadata: { pluginId: string },
    accessRule: { id: string }
  ): Promise<void> {
    if (userIds.length === 0) return;

    if (!this.authClient) {
      this.logger.warn(
        `sendToAuthorizedUsers called but auth client not set. Skipping signal ${signal.id}`
      );
      return;
    }

    // Construct fully-qualified access rule ID: ${pluginMetadata.pluginId}.${accessRule.id}
    const qualifiedAccessRule = qualifyAccessRuleId(pluginMetadata, accessRule);

    // Filter users via auth RPC. Best-effort like the send itself: if the auth
    // lookup transiently fails, skip the live nudge rather than fail the caller's
    // already-committed write.
    let authorizedIds: string[];
    try {
      authorizedIds = await this.authClient.filterUsersByAccessRule({
        userIds,
        accessRule: qualifiedAccessRule,
      });
    } catch (error) {
      this.logger.warn(
        `Signal delivery failed (authz filter for ${signal.id}) - the write succeeded; clients will reconcile on next fetch.`,
        { error },
      );
      return;
    }

    if (authorizedIds.length === 0) {
      this.logger.debug(
        `No users authorized for signal ${signal.id} with access ${qualifiedAccessRule}`
      );
      return;
    }

    this.logger.debug(
      `Sending signal ${signal.id} to ${authorizedIds.length}/${userIds.length} authorized users`
    );

    await this.sendToUsers(signal, authorizedIds, payload);
  }
}
