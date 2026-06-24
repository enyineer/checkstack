import type { PluginMetadata } from "@checkstack/common";
import { createExtensionPoint } from "./extension-point";

/**
 * A same-origin URL path prefix that belongs to a public surface owned by a
 * plugin - e.g. a published status page at `/statuspage/view/:slug`.
 *
 * The platform surfaces every registered prefix to the frontend via
 * `/api/config` (and the inlined boot blob) so the SPA entry can load the LEAN
 * public bundle for these paths instead of booting the full admin app. The
 * platform never interprets the prefix; this keeps the dependency direction
 * correct (the platform DEFINES the contract, the owning plugin SUPPLIES the
 * prefix). It is the same-origin counterpart to the custom-domain
 * {@link PublicHostResolver}.
 */
export interface PublicPathExtensionPoint {
  /**
   * Declare a path prefix (e.g. `/statuspage/view`) whose pages are public and
   * must render via the lean public bundle. A request whose pathname equals the
   * prefix or starts with `${prefix}/` is treated as public.
   */
  registerPublicPath(
    def: { pathPrefix: string },
    pluginMetadata: PluginMetadata,
  ): void;
}

export const publicPathExtensionPoint =
  createExtensionPoint<PublicPathExtensionPoint>("core.publicPath");
