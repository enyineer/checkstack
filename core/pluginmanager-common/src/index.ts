export { pluginMetadata } from "./plugin-metadata";
export { pluginManagerRoutes } from "./routes";
export { pluginManagerAccess, pluginManagerAccessRules } from "./access";
export {
  pluginManagerContract,
  PluginManagerApi,
  type PluginManagerContract,
} from "./rpc-contract";
// Re-export source types from `@checkstack/common` so consumers only need
// one import for the contract + its inputs/outputs.
export {
  pluginSourceSchema,
  type PluginSource,
  type NpmPluginSource,
  type TarballPluginSource,
  type GithubPluginSource,
  type CatalogPluginSource,
} from "@checkstack/common";

export {
  compatibilityIssueSchema,
  installPreviewSchema,
  uninstallPreviewSchema,
  installedPluginSchema,
  installEventSchema,
  installEventActionEnum,
  installEventPhaseEnum,
  installEventStatusEnum,
  type CompatibilityIssue,
  type InstallPreview,
  type UninstallPreview,
  type InstalledPlugin,
  type InstallEvent,
  type InstallEventAction,
  type InstallEventPhase,
  type InstallEventStatus,
} from "./schemas";
