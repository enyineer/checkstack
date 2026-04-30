import type { ComponentType } from "react";
import { Box } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Frontend rendering metadata for a notification subject `kind`. Domain
 * plugins register their kinds at module load (typically from each
 * `*-frontend` package's plugin entry point) so the bell and notifications
 * page can show kind-appropriate icons and labels.
 *
 * Kinds are namespaced as `<pluginId>.<localKind>` (matching the backend
 * convention enforced by `NotificationSubjectSchema`). Unknown kinds
 * (e.g., from a plugin the current user hasn't installed) fall back to a
 * generic chip.
 */
export interface SubjectKindRenderer {
  /** Human-readable singular label, e.g., "System". */
  label: string;
  /** Lucide icon component shown in the chip. */
  icon: LucideIcon | ComponentType<{ className?: string }>;
}

const registry = new Map<string, SubjectKindRenderer>();

/**
 * Register frontend rendering metadata for a notification subject kind.
 * Idempotent — re-registering the same kind overwrites the prior entry.
 *
 * Example:
 * ```ts
 * import { Server } from "lucide-react";
 * import { registerSubjectKind } from "@checkstack/notification-frontend";
 *
 * registerSubjectKind("catalog.system", { label: "System", icon: Server });
 * ```
 */
export function registerSubjectKind(
  kind: string,
  renderer: SubjectKindRenderer,
): void {
  registry.set(kind, renderer);
}

/** Default renderer used for unknown / unregistered kinds. */
const FALLBACK_RENDERER: SubjectKindRenderer = {
  label: "Subject",
  icon: Box,
};

/**
 * Look up the renderer for a kind, falling back to a generic chip when the
 * kind hasn't been registered (e.g., emitted by a plugin not loaded in
 * this frontend bundle).
 */
export function getSubjectKindRenderer(kind: string): SubjectKindRenderer {
  return registry.get(kind) ?? FALLBACK_RENDERER;
}
