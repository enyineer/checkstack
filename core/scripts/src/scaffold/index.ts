export {
  rewriteWorkspaceVersions,
  DEPENDENCY_SECTIONS,
  type DependencySection,
  type VersionResolver,
  type RewritablePackageJson,
  type RewriteResult,
} from "./rewrite-workspace-versions";
export { createWorkspaceMapResolver } from "./resolve-versions";
export {
  scaffoldPlugin,
  scaffoldStandaloneRoot,
  refreshMonorepoReferences,
  resolveTargetDir,
  TEMPLATES_DIR,
  STANDALONE_ROOT_TEMPLATE_DIR,
  type ScaffoldMode,
  type ScaffoldIo,
  type ScaffoldPluginOptions,
  type ScaffoldPluginResult,
  type ScaffoldStandaloneRootResult,
} from "./scaffold-plugin";
