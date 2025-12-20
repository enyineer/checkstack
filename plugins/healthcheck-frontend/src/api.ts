import { createApiRef, DiscoveryApi } from "@checkmate/frontend-api";
import {
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  HealthCheckStrategyDto,
  AssociateHealthCheck,
} from "@checkmate/healthcheck-common";

export interface HealthCheckApi {
  getStrategies(): Promise<HealthCheckStrategyDto[]>;
  getConfigurations(): Promise<HealthCheckConfiguration[]>;
  createConfiguration(
    data: CreateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration>;
  updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration>;
  deleteConfiguration(id: string): Promise<void>;

  getSystemConfigurations(
    systemId: string
  ): Promise<HealthCheckConfiguration[]>;
  associateSystem(systemId: string, data: AssociateHealthCheck): Promise<void>;
  disassociateSystem(systemId: string, configId: string): Promise<void>;
}

export const healthCheckApiRef =
  createApiRef<HealthCheckApi>("healthcheck-api");

export class HealthCheckClient implements HealthCheckApi {
  constructor(private discoveryApi: DiscoveryApi) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl("healthcheck-backend");
    const res = await fetch(`${baseUrl}${path}`, init);

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return undefined as unknown as T;
    }

    return res.json();
  }

  async getStrategies(): Promise<HealthCheckStrategyDto[]> {
    return this.fetch<HealthCheckStrategyDto[]>("/strategies");
  }

  async getConfigurations(): Promise<HealthCheckConfiguration[]> {
    return this.fetch<HealthCheckConfiguration[]>("/configurations");
  }

  async createConfiguration(
    data: CreateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration> {
    return this.fetch<HealthCheckConfiguration>("/configurations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async updateConfiguration(
    id: string,
    data: UpdateHealthCheckConfiguration
  ): Promise<HealthCheckConfiguration> {
    return this.fetch<HealthCheckConfiguration>(`/configurations/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteConfiguration(id: string): Promise<void> {
    return this.fetch<void>(`/configurations/${id}`, {
      method: "DELETE",
    });
  }

  async getSystemConfigurations(
    systemId: string
  ): Promise<HealthCheckConfiguration[]> {
    return this.fetch<HealthCheckConfiguration[]>(
      `/systems/${systemId}/checks`
    );
  }

  async associateSystem(
    systemId: string,
    data: AssociateHealthCheck
  ): Promise<void> {
    return this.fetch<void>(`/systems/${systemId}/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async disassociateSystem(systemId: string, configId: string): Promise<void> {
    return this.fetch<void>(`/systems/${systemId}/checks/${configId}`, {
      method: "DELETE",
    });
  }
}
