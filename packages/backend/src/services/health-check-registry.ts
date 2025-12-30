import {
  HealthCheckRegistry,
  HealthCheckStrategy,
} from "@checkmate/backend-api";
import { rootLogger } from "../logger";

export class CoreHealthCheckRegistry implements HealthCheckRegistry {
  private strategies = new Map<string, HealthCheckStrategy>();

  register(strategy: HealthCheckStrategy) {
    if (this.strategies.has(strategy.id)) {
      rootLogger.warn(
        `HealthCheckStrategy '${strategy.id}' is already registered. Overwriting.`
      );
    }
    this.strategies.set(strategy.id, strategy);
    rootLogger.debug(`✅ Registered HealthCheckStrategy: ${strategy.id}`);
  }

  getStrategy(id: string) {
    return this.strategies.get(id);
  }

  getStrategies() {
    return [...this.strategies.values()];
  }
}
