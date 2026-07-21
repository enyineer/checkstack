import { pillToneStyles } from "@checkstack/ui";
import type { InstalledPlugin } from "@checkstack/pluginmanager-common";

/**
 * Visual tones for an installed plugin, mapped onto the colorblind-safe status
 * triad. Runtime-installed (uninstallable) plugins read as an "ok" signal;
 * bundled core plugins are neutral ("unknown"). The display label text is kept
 * exactly as before ("runtime" / "core").
 */
export type PluginTone = "ok" | "unknown";

export interface PluginToneClasses {
  pill: string;
  dot: string;
  accent: string;
}

/**
 * Per-tone class sets for the plugin status pill, dot, and card accent stripe,
 * taken from the shared `pillToneStyles` table rather than a private copy.
 */
export const PLUGIN_TONE_STYLES: Record<PluginTone, PluginToneClasses> = {
  ok: pillToneStyles.ok,
  unknown: pillToneStyles.unknown,
};

/**
 * Classify an installed plugin's status into the triad tone and the existing
 * user-visible label. Pure logic so it can be unit tested.
 */
export function presentPluginStatus({
  isUninstallable,
}: {
  isUninstallable: boolean;
}): { tone: PluginTone; label: string } {
  return isUninstallable
    ? { tone: "ok", label: "runtime" }
    : { tone: "unknown", label: "core" };
}

/**
 * Resolve the user-visible source label for a plugin. Runtime plugins carry a
 * source type (npm / github / tarball); bundled plugins report "monorepo".
 * Label text is unchanged from the prior implementation.
 */
export function presentPluginSource({
  source,
}: {
  source: InstalledPlugin["source"];
}): string {
  return source ? source.type : "monorepo";
}
