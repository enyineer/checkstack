import React from "react";
import { cn } from "@checkstack/ui";
import { PLUGIN_TONE_STYLES, presentPluginStatus } from "./pluginDisplay.logic";

/**
 * Triad status pill for an installed plugin. Status is multi-encoded as hue +
 * dot + text label (never color alone). Runtime-installed plugins read "runtime"
 * (ok), bundled core plugins read "core" (neutral). Labels are unchanged from
 * the prior badge implementation.
 */
export const PluginStatusPill: React.FC<{ isUninstallable: boolean }> = ({
  isUninstallable,
}) => {
  const { tone, label } = presentPluginStatus({ isUninstallable });
  const styles = PLUGIN_TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
};
