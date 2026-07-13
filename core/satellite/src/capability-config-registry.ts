interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/**
 * A SAT-B-registered consumer of one capability `kind` on the agent. The core
 * pushes `capability_config` for a kind (e.g. the scrape targets bound to this
 * satellite); the registry routes the opaque payload to the consumer for that
 * kind. A consumer also SOURCES `capability_status` back to the core via
 * {@link AgentCapabilityRegistry.emitStatus}.
 *
 * A2 owns only this generic seam; the concrete receivers/scrapers (which parse
 * the config and produce status) are SAT-B's.
 */
export interface AgentCapabilityConsumer {
  /** The capability kind this consumer handles (e.g. "metric-scrape"). */
  kind: string;
  /** Apply a pushed capability configuration (opaque payload). */
  onCapabilityConfig?(input: { payload: unknown }): void | Promise<void>;
}

/**
 * Agent-side registry wiring pushed `capability_config` to the right consumer
 * and letting consumers emit `capability_status` back to the core. Symmetric to
 * the core-side capability extension point, but process-local to the agent.
 */
export class AgentCapabilityRegistry {
  private readonly consumers = new Map<string, AgentCapabilityConsumer>();

  constructor(
    private readonly opts: {
      /** Sends a capability_status envelope over the live socket. */
      sendStatus: (input: { kind: string; payload: unknown }) => void;
      logger?: Logger;
    },
  ) {}

  /** Register a consumer for its kind (last registration for a kind wins). */
  register(consumer: AgentCapabilityConsumer): void {
    if (this.consumers.has(consumer.kind)) {
      this.opts.logger?.warn(
        `Agent capability consumer for kind "${consumer.kind}" is being replaced`,
      );
    }
    this.consumers.set(consumer.kind, consumer);
  }

  /** Route a pushed capability_config to its consumer. */
  handleCapabilityConfig(input: { kind: string; payload: unknown }): void {
    const consumer = this.consumers.get(input.kind);
    if (!consumer?.onCapabilityConfig) {
      this.opts.logger?.debug(
        `No agent consumer for capability_config kind "${input.kind}"; ignoring`,
      );
      return;
    }
    try {
      const maybePromise = consumer.onCapabilityConfig({
        payload: input.payload,
      });
      if (maybePromise) {
        void maybePromise.catch((error: unknown) => {
          this.opts.logger?.error(
            `Agent consumer for "${input.kind}" failed to apply config: ${String(error)}`,
          );
        });
      }
    } catch (error) {
      this.opts.logger?.error(
        `Agent consumer for "${input.kind}" threw applying config: ${String(error)}`,
      );
    }
  }

  /** Emit a capability_status update from a consumer to the core. */
  emitStatus(input: { kind: string; payload: unknown }): void {
    this.opts.sendStatus(input);
  }
}
