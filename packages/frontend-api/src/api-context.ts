import React, { createContext, useContext, ReactNode } from "react";
import { ApiRef } from "./api-ref";

export type ApiRegistry = Map<string, unknown>;

const ApiContext = createContext<ApiRegistry | undefined>(undefined);

export class ApiRegistryBuilder {
  private registry: ApiRegistry = new Map();

  register<T>(ref: ApiRef<T>, impl: T) {
    this.registry.set(ref.id, impl);
    return this;
  }

  registerFactory<T>(ref: ApiRef<T>, factory: (registry: ApiRegistry) => T) {
    const impl = factory(this.registry);
    this.registry.set(ref.id, impl);
    return this;
  }

  build() {
    return this.registry;
  }
}

export const ApiProvider = ({
  registry,
  children,
}: {
  registry: ApiRegistry;
  children: ReactNode;
}) => {
  return React.createElement(
    ApiContext.Provider,
    { value: registry },
    children
  );
};

export function useApi<T>(ref: ApiRef<T>): T {
  const registry = useContext(ApiContext);
  if (!registry) {
    throw new Error("useApi must be used within an ApiProvider");
  }

  const output = registry.get(ref.id);
  if (!output) {
    throw new Error(`No implementation found for API '${ref.id}'`);
  }

  return output as T;
}
