import { createApiRef } from "@checkmate/frontend-api";

export interface System {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  systemId: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface View {
  id: string;
  name: string;
  description?: string;
  configuration: any;
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

  getGroups(): Promise<Group[]>;
  createGroup(group: Partial<Group>): Promise<Group>;

  getViews(): Promise<View[]>;
  createView(view: Partial<View>): Promise<View>;

  getIncidents(): Promise<Incident[]>;
  createIncident(incident: Partial<Incident>): Promise<Incident>;
}

export const catalogApiRef = createApiRef<CatalogApi>("plugin.catalog.api");
