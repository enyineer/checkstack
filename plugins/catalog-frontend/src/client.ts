import { CatalogApi, System, Group, View, Incident } from "./api";
import { FetchApi } from "@checkmate/frontend-api";

export class CatalogClient implements CatalogApi {
  constructor(private fetchApi: FetchApi) {}

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchApi
      .forPlugin("catalog-backend")
      .fetch(path, init);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json();
  }

  async getSystems(): Promise<System[]> {
    const data = await this.fetch<{ systems: System[] }>("/entities");
    return data.systems;
  }

  async createSystem(system: Partial<System>): Promise<System> {
    return this.fetch<System>("/entities/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(system),
    });
  }

  async updateSystem(id: string, system: Partial<System>): Promise<System> {
    return this.fetch<System>(`/entities/systems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(system),
    });
  }

  async deleteSystem(id: string): Promise<void> {
    await this.fetch(`/entities/systems/${id}`, {
      method: "DELETE",
    });
  }

  async getGroups(): Promise<Group[]> {
    const data = await this.fetch<{ groups: Group[] }>("/entities");
    // Backend returns { systems, groups } on /entities GET.
    // Optimization: separate endpoints? For now reuse.
    return data.groups;
  }

  async createGroup(group: Partial<Group>): Promise<Group> {
    return this.fetch<Group>("/entities/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(group),
    });
  }

  async updateGroup(id: string, group: Partial<Group>): Promise<Group> {
    return this.fetch<Group>(`/entities/groups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(group),
    });
  }

  async deleteGroup(id: string): Promise<void> {
    await this.fetch(`/entities/groups/${id}`, {
      method: "DELETE",
    });
  }

  async getViews(): Promise<View[]> {
    return this.fetch<View[]>("/views");
  }

  async createView(view: Partial<View>): Promise<View> {
    return this.fetch<View>("/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(view),
    });
  }

  async getIncidents(): Promise<Incident[]> {
    return this.fetch<Incident[]>("/incidents");
  }

  async createIncident(incident: Partial<Incident>): Promise<Incident> {
    return this.fetch<Incident>("/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(incident),
    });
  }
}
