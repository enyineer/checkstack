import { ServiceRef } from "@checkmate/core-api";

type ServiceFactory<T> = (pluginId: string) => T | Promise<T>;

export class ServiceRegistry {
  private services = new Map<string, any>();
  private factories = new Map<string, ServiceFactory<any>>();

  register<T>(ref: ServiceRef<T>, impl: T) {
    this.services.set(ref.id, impl);
  }

  registerFactory<T>(ref: ServiceRef<T>, factory: ServiceFactory<T>) {
    this.factories.set(ref.id, factory);
  }

  async get<T>(ref: ServiceRef<T>, pluginId: string): Promise<T> {
    // 1. Try Factory (Scoped)
    const factory = this.factories.get(ref.id);
    if (factory) {
      return await factory(pluginId);
    }

    // 2. Try Global Service
    const service = this.services.get(ref.id);
    if (service) {
      return service;
    }

    throw new Error(`Service '${ref.id}' not found for plugin '${pluginId}'`);
  }
}
