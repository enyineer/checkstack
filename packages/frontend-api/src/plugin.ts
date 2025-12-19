import React from "react";
import { ApiRef } from "./api-ref";

export interface FrontendPlugin {
  name: string;
  apis?: {
    ref: ApiRef<any>;
    factory: (deps: any) => any;
  }[];
  routes?: {
    path: string;
    element?: React.ReactNode;
    title?: string;
  }[];
  navItems?: {
    title: string;
    path: string;
    icon?: any;
  }[];
}
