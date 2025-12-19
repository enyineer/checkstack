import {
  HealthCheckRegistry,
  HealthCheckStrategy,
} from "@checkmate/backend-api";

export class CoreHealthCheckRegistry implements HealthCheckRegistry {
  private strategies = new Map<string, HealthCheckStrategy>();

  register(strategy: HealthCheckStrategy) {
    if (this.strategies.has(strategy.id)) {
      console.warn(
        `HealthCheckStrategy '${strategy.id}' is already registered. Overwriting.`
      );
    }
    this.strategies.set(strategy.id, strategy);
    console.log(`✅ Registered HealthCheckStrategy: ${strategy.id}`);
  }

  getStrategy(id: string) {
    return this.strategies.get(id);
  }

  getStrategies() {
    return [...this.strategies.values()];
  }
}
