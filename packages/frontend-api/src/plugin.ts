import React from "react";
import { ApiRef } from "./api-ref";

export interface Extension<T = unknown> {
  id: string;
  slotId: string;
  component: React.ComponentType<T>;
}

export interface FrontendPlugin {
  name: string;
  extensions?: Extension[];
  apis?: {
    ref: ApiRef<unknown>;
    factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => unknown;
  }[];
  routes?: {
    path: string;
    element?: React.ReactNode;
    title?: string;
    permission?: string;
  }[];
  navItems?: {
    title: string;
    path: string;
    icon?: React.ComponentType | React.ReactNode;
  }[];
}

export function createFrontendPlugin(plugin: FrontendPlugin): FrontendPlugin {
  return plugin;
}
