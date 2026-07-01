/** @jsxImportSource @opentui/react */
import type { ProcessDef } from "../../dev-tui/process-config.ts";
import type { ProcessStore } from "../process-store.ts";
import { useProcessStore, useSpinnerFrame } from "../hooks.ts";
import { ACCENT } from "../theme.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface TeardownInstance {
  readonly label: string;
  readonly store: ProcessStore;
  readonly defs: readonly ProcessDef[];
}

/**
 * Centered "shutting down" overlay shown while the runner tears down every
 * running instance. Each long-running process shows a spinner until its child
 * has exited (stopped OR errored - a killed dev server commonly exits non-zero,
 * which is expected teardown), then a green check.
 */
export function ShutdownScreen({
  width,
  height,
  instances,
}: {
  width: number;
  height: number;
  instances: readonly TeardownInstance[];
}) {
  const frame = useSpinnerFrame();
  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <text>
        <span fg={ACCENT}>{SPINNER[frame % SPINNER.length]}</span>
        <span fg={ACCENT}> Shutting down checkstack cockpit</span>
      </text>
      <box flexDirection="column" paddingTop={1}>
        {instances.length === 0 ? (
          <text fg="gray">No running instances.</text>
        ) : (
          instances.map((instance) => (
            <TeardownList
              key={instance.label}
              label={instance.label}
              store={instance.store}
              defs={instance.defs}
              frame={frame}
            />
          ))
        )}
      </box>
    </box>
  );
}

function TeardownList({
  label,
  store,
  defs,
  frame,
}: {
  label: string;
  store: ProcessStore;
  defs: readonly ProcessDef[];
  frame: number;
}) {
  const { statuses } = useProcessStore(store);
  const longRunning = defs.filter((def) => !def.oneShot);
  return (
    <box flexDirection="column">
      {longRunning.map((def) => {
        const status = statuses[def.id];
        const exited = status === "stopped" || status === "errored";
        return (
          <text key={`${label}-${def.id}`} fg="gray">
            {exited ? (
              <span fg="green">✓</span>
            ) : (
              <span fg="gray">{SPINNER[frame % SPINNER.length]}</span>
            )}
            {` ${label}: ${def.label}${exited ? " stopped" : "…"}`}
          </text>
        );
      })}
    </box>
  );
}
