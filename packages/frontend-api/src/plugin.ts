import React from "react";
import { ApiRef } from "./api-ref";

export interface FrontendPlugin {
  name: string;
  apis?: {
    ref: ApiRef<unknown>;
    factory: (deps: { get: <T>(ref: ApiRef<T>) => T }) => unknown;
  }[];
  routes?: {
    path: string;
    element?: React.ReactNode;
    title?: string;
  }[];
  navItems?: {
    title: string;
    path: string;
    icon?: React.ComponentType | React.ReactNode;
  }[];
}
