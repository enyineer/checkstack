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
 * Per-tone class sets for the plugin status pill, dot, and card accent stripe.
 * Spelled out as full literal strings so Tailwind's JIT keeps them.
 */
export const PLUGIN_TONE_STYLES: Record<PluginTone, PluginToneClasses> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
  },
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
