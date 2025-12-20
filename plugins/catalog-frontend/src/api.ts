import { createApiRef } from "@checkmate/frontend-api";

export interface System {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  status: "healthy" | "degraded" | "unhealthy";
  metadata?: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  systemIds?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface View {
  id: string;
  name: string;
  description?: string;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  title: string;
  description?: string;
  status: string;
  severity: string;
  systemId?: string;
  groupId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogApi {
  getSystems(): Promise<System[]>;
  createSystem(system: Partial<System>): Promise<System>;
  updateSystem(id: string, system: Partial<System>): Promise<System>;
  deleteSystem(id: string): Promise<void>;

  getGroups(): Promise<Group[]>;
  createGroup(group: Partial<Group>): Promise<Group>;
  updateGroup(id: string, group: Partial<Group>): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  addSystemToGroup(groupId: string, systemId: string): Promise<void>;
  removeSystemFromGroup(groupId: string, systemId: string): Promise<void>;

  getViews(): Promise<View[]>;
  createView(view: Partial<View>): Promise<View>;

  getIncidents(): Promise<Incident[]>;
  createIncident(incident: Partial<Incident>): Promise<Incident>;
}

export const catalogApiRef = createApiRef<CatalogApi>("plugin.catalog.api");
