/**
 * Module Federation remote name for a runtime plugin, derived deterministically
 * from its npm package name so the host and the scaffolded plugin's federation
 * config agree without coordination. MF remote names must be identifier-safe.
 * e.g. `@checkstackit/widget-frontend` -> `checkstackit_widget_frontend`.
 */
export function mfRemoteName(packageName: string): string {
  return packageName.replace(/^@/, "").replaceAll(/[^a-zA-Z0-9]/g, "_");
}

/** Manifest URL the backend serves for a runtime plugin's MF remote. */
export function remoteEntryFor(packageName: string): string {
  return `/assets/plugins/${packageName}/mf-manifest.json`;
}
