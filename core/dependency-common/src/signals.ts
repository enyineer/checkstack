import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import { dependencyAccess } from "./access";
import { dependencyRoutes } from "./routes";
import type { DependencyWarning, DerivedState } from "./schemas";

/**
 * Stable source id for dependency system signals. Surfaced as `source` on each
 * emitted signal and used as the contributor id by the backend aggregator.
 */
export const DEPENDENCY_SIGNAL_SOURCE_ID = "dependency";

/**
 * Maps a derived dependency warning state to a {@link SystemSignal} tone.
 */
const stateToTone: Record<DerivedState, SystemSignal["tone"]> = {
  down: "error",
  degraded: "warn",
  info: "info",
};

/**
 * Maps a derived dependency warning state to a {@link SystemSignal} label.
 */
const stateToLabel: Record<DerivedState, string> = {
  down: "Upstream down",
  degraded: "Upstream degraded",
  info: "Dependency info",
};

/**
 * Pure deriver shared by the dependency frontend signals filler and the backend
 * `system.issues` contributor. Turns computed dependency warnings (keyed by
 * systemId) into a {@link SystemSignalsMap}, emitting one signal per system that
 * has a warning. Systems without a warning are absent from the result.
 *
 * The output is byte-for-byte identical between frontend and backend so both
 * surfaces agree on source/tone/label/detail/href/accessRule/iconName.
 */
export function deriveDependencySignals({
  warnings,
}: {
  warnings: Record<string, DependencyWarning>;
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};

  for (const [systemId, warning] of Object.entries(warnings)) {
    if (!warning) continue;

    const upstreamCount = warning.affectedUpstreams.length;
    const signal: SystemSignal = {
      source: DEPENDENCY_SIGNAL_SOURCE_ID,
      tone: stateToTone[warning.derivedState],
      label: stateToLabel[warning.derivedState],
      detail:
        upstreamCount > 0
          ? `${upstreamCount} upstream ${upstreamCount === 1 ? "system" : "systems"} affected`
          : undefined,
      href: resolveRoute(dependencyRoutes.routes.map),
      // The dependency map is gated by its own rule; users who can see the
      // warning (dependency.read) but not the map get plain text, not a link.
      accessRule: dependencyAccess.map,
      iconName: "GitBranch",
    };
    result[systemId] = [signal];
  }

  return result;
}
