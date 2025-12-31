import type { EventBus, Logger } from "@checkmate/backend-api";
import type {
  Signal,
  SignalMessage,
  SignalService,
} from "@checkmate/signal-common";
import { SIGNAL_BROADCAST_HOOK, SIGNAL_USER_HOOK } from "./hooks";

/**
 * SignalService implementation that uses EventBus for multi-instance coordination.
 *
 * When a signal is emitted, it goes through the EventBus (backed by the queue system),
 * ensuring all backend instances receive it and can push to their local WebSocket clients.
 */
export class SignalServiceImpl implements SignalService {
  constructor(private eventBus: EventBus, private logger: Logger) {}

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
}
