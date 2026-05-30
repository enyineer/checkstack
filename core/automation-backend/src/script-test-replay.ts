/**
 * Replay support for the in-UI script test panel.
 *
 * Reconstructs an editable {@link ScriptTestContext} from a real automation
 * run so an operator can debug a `run_script` / `run_shell` action against
 * the data a past (or in-flight) run actually saw, instead of a synthetic
 * sample.
 *
 * Data sources, in order of durability:
 *   - `automation_runs` — always present; gives `trigger.event` +
 *     `trigger.payload`.
 *   - `automation_artifacts` — persisted per run; rebuilt into the
 *     `artifacts` record keyed by artifact type (and by action id), matching
 *     what `run_script` exposes as `context.artifacts`.
 *   - `automation_run_state.scopeSnapshot` — present only while the run is
 *     in-flight / suspended (cleared at terminal status). When available it
 *     supplies `var` and `repeat`; otherwise those are empty, which is fine
 *     for editing a fresh test.
 *
 * Pure data-shaping over already-fetched rows so it is unit-testable without
 * a DB.
 */
import type { ScriptTestContext } from "@checkstack/automation-common";

export interface ReplayRunRow {
  triggerEventId: string;
  triggerPayload: Record<string, unknown>;
}

export interface ReplayArtifactRow {
  artifactType: string;
  actionId: string | null;
  data: Record<string, unknown>;
}

/**
 * Build the `artifacts` record a script sees, keyed by artifact type and
 * (when set) by action id. Mirrors the dispatch engine's exposure so a
 * replayed context matches runtime. Later artifacts of the same key win
 * (callers pass rows in chronological order).
 */
export function buildReplayArtifacts(
  rows: ReplayArtifactRow[],
): Record<string, unknown> {
  const artifacts: Record<string, unknown> = {};
  for (const row of rows) {
    artifacts[row.artifactType] = row.data;
    if (row.actionId) {
      artifacts[row.actionId] = row.data;
    }
  }
  return artifacts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRepeat(
  snapshot: Record<string, unknown> | undefined,
): ScriptTestContext["repeat"] {
  const repeat = snapshot?.repeat;
  if (!isRecord(repeat)) return undefined;
  if (typeof repeat.index !== "number") return undefined;
  return {
    index: repeat.index,
    ...(repeat.item === undefined ? {} : { item: repeat.item }),
  };
}

/**
 * Assemble the editable replay context from already-fetched run rows.
 *
 * @param run - the `automation_runs` row (trigger source of truth)
 * @param artifacts - persisted artifacts for the run, chronological
 * @param scopeSnapshot - `automation_run_state.scopeSnapshot` if the run is
 *   still in-flight / suspended, else undefined
 */
export function buildReplayContext({
  run,
  artifacts,
  scopeSnapshot,
}: {
  run: ReplayRunRow;
  artifacts: ReplayArtifactRow[];
  scopeSnapshot?: Record<string, unknown>;
}): ScriptTestContext {
  const vars = isRecord(scopeSnapshot?.vars) ? scopeSnapshot.vars : {};
  const repeat = extractRepeat(scopeSnapshot);

  return {
    trigger: {
      event: run.triggerEventId,
      payload: run.triggerPayload,
    },
    artifacts: buildReplayArtifacts(artifacts),
    var: vars,
    ...(repeat ? { repeat } : {}),
  };
}
