import React from "react";

export interface FrontendPlugin {
  name: string;
  apis?: {
    ref: any; // ApiRef<T>
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

class PluginRegistry {
  private plugins: FrontendPlugin[] = [];

  register(plugin: FrontendPlugin) {
    console.log(`🔌 Registering frontend plugin: ${plugin.name}`);
    this.plugins.push(plugin);
  }

  getPlugins() {
    return this.plugins;
  }
}

export const pluginRegistry = new PluginRegistry();
