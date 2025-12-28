import { createApiRef, FetchApi } from "@checkmate/frontend-api";
import {
  QueuePluginDto,
  QueueConfigurationDto,
  UpdateQueueConfiguration,
} from "@checkmate/queue-common";

export interface QueueApi {
  getPlugins(): Promise<QueuePluginDto[]>;
  getConfiguration(): Promise<QueueConfigurationDto>;
  updateConfiguration(
    data: UpdateQueueConfiguration
  ): Promise<QueueConfigurationDto>;
}

export const queueApiRef = createApiRef<QueueApi>("queue-api");

export class QueueApiClient implements QueueApi {
  constructor(private fetchApi: FetchApi) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchApi
      .forPlugin("queue-backend")
      .fetch(path, init);

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    const text = await res.text();
    if (!text) {
      return undefined as unknown as T;
    }

    return JSON.parse(text);
  }

  async getPlugins(): Promise<QueuePluginDto[]> {
    return this.fetch<QueuePluginDto[]>("/plugins");
  }

  async getConfiguration(): Promise<QueueConfigurationDto> {
    return this.fetch<QueueConfigurationDto>("/configuration");
  }

  async updateConfiguration(
    data: UpdateQueueConfiguration
  ): Promise<QueueConfigurationDto> {
    return this.fetch<QueueConfigurationDto>("/configuration", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }
}
