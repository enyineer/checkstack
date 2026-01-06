import { ServiceRef } from "@checkmate-monitor/backend-api";
import type { PluginMetadata } from "@checkmate-monitor/common";

type ServiceFactory<T> = (metadata: PluginMetadata) => T | Promise<T>;

export class ServiceRegistry {
  private services = new Map<string, unknown>();
  private factories = new Map<string, ServiceFactory<unknown>>();

  register<T>(ref: ServiceRef<T>, impl: T) {
    this.services.set(ref.id, impl);
  }

  registerFactory<T>(ref: ServiceRef<T>, factory: ServiceFactory<T>) {
    this.factories.set(ref.id, factory as ServiceFactory<unknown>);
  }

  async get<T>(ref: ServiceRef<T>, metadata: PluginMetadata): Promise<T> {
    // 1. Try Factory (Scoped)
    const factory = this.factories.get(ref.id);
    if (factory) {
      return (await factory(metadata)) as T;
    }

    // 2. Try Global Service
    const service = this.services.get(ref.id);
    if (service) {
      return service as T;
    }

    throw new Error(
      `Service '${ref.id}' not found for plugin '${metadata.pluginId}'`
    );
  }
}
