/** @jsxImportSource @opentui/react */
import type { ProcessId, ProcessStatus } from "../../dev-tui/types.ts";
import { statusColor } from "../theme.ts";

export interface ProcessRow {
  readonly id: ProcessId;
  readonly label: string;
  readonly status: ProcessStatus;
}

/** A compact list of supervised processes with a coloured status dot each. */
export function ProcessList({ rows }: { rows: readonly ProcessRow[] }) {
  return (
    <box flexDirection="column">
      {rows.map((row) => (
        <text key={row.id}>
          <span fg={statusColor(row.status)}>●</span> {row.label}{" "}
          <span fg="gray">{row.status}</span>
        </text>
      ))}
    </box>
  );
}
