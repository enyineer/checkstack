import type { EventBus, Logger } from "@checkmate/backend-api";
import { qualifyPermissionId } from "@checkmate/common";
import type {
  Signal,
  SignalMessage,
  SignalService,
} from "@checkmate/signal-common";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "./hooks";

/**
 * Interface for the auth client methods needed by SignalService.
 * This is a subset of the AuthApi client to avoid circular dependencies.
 */
interface AuthClientForSignals {
  filterUsersByPermission: (input: {
    userIds: string[];
    permission: string;
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
   * Set the auth client for permission-based signal filtering.
   * This should be called after plugins have loaded.
   */
  setAuthClient(client: AuthClientForSignals): void {
    this.authClient = client;
  }

  async broadcast<T>(signal: Signal<T>, payload: T): Promise<void> {
    const message: SignalMessage<T> = {
      signalId: signal.id,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(`Broadcasting signal: ${signal.id}`);

    // Emit to EventBus - all backend instances receive and push to their WebSocket clients
    await this.eventBus.emit(SIGNAL_BROADCAST_HOOK, message);
  }

  async sendToUser<T>(
    signal: Signal<T>,
    userId: string,
    payload: T
  ): Promise<void> {
    const message: SignalMessage<T> = {
      signalId: signal.id,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.logger.debug(`Sending signal ${signal.id} to user ${userId}`);

    await this.eventBus.emit(SIGNAL_USER_HOOK, { userId, message });
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
    permission: { id: string }
  ): Promise<void> {
    if (userIds.length === 0) return;

    if (!this.authClient) {
      this.logger.warn(
        `sendToAuthorizedUsers called but auth client not set. Skipping signal ${signal.id}`
      );
      return;
    }

    // Construct fully-qualified permission ID: ${pluginMetadata.pluginId}.${permission.id}
    const qualifiedPermission = qualifyPermissionId(pluginMetadata, permission);

    // Filter users via auth RPC
    const authorizedIds = await this.authClient.filterUsersByPermission({
      userIds,
      permission: qualifiedPermission,
    });

    if (authorizedIds.length === 0) {
      this.logger.debug(
        `No users authorized for signal ${signal.id} with permission ${qualifiedPermission}`
      );
      return;
    }

    this.logger.debug(
      `Sending signal ${signal.id} to ${authorizedIds.length}/${userIds.length} authorized users`
    );

    await this.sendToUsers(signal, authorizedIds, payload);
  }
}
