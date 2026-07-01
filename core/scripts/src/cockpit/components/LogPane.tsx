/** @jsxImportSource @opentui/react */
import type { CapturedLine } from "../../dev-tui/supervisor.ts";
import { levelColor } from "../theme.ts";

/**
 * Auto-tailing log view: renders the last `visible` lines (newest at the
 * bottom), each coloured by its detected level. A plain box tail keeps rendering
 * cheap and predictable versus an interactive scrollbox.
 */
export function LogPane({
  lines,
  visible,
}: {
  lines: readonly CapturedLine[];
  visible: number;
}) {
  const tail = lines.slice(Math.max(0, lines.length - visible));
  return (
    <box flexDirection="column" flexGrow={1}>
      {tail.map((line) => (
        <text key={line.seq} fg={levelColor(line.level)}>
          {`[${line.source}] ${line.text}`}
        </text>
      ))}
    </box>
  );
}
