/** @jsxImportSource @opentui/react */
import { useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ProcessDef } from "../../dev-tui/process-config.ts";
import type { ProcessId } from "../../dev-tui/types.ts";
import { ALERTS_CAPACITY, type ProcessStore } from "../process-store.ts";
import { useProcessStore } from "../hooks.ts";
import { ACCENT, levelColor, statusColor } from "../theme.ts";

const SIDEBAR_WIDTH = 26;

/**
 * The full instance panel: a process sidebar (status dot + unread alert badge +
 * focus marker), the focused process's scrollback log (tail-following, scrollable),
 * and a pinned alerts panel. Handles Tab/Arrows to switch focus, Up/Down/PgUp/PgDn
 * to scroll, and `r` to restart the focused process. Shared by the dev and preview
 * instances so both have identical, full-featured supervision.
 */
export function InstancePanel({
  store,
  defs,
  active = true,
}: {
  store: ProcessStore;
  defs: readonly ProcessDef[];
  active?: boolean;
}) {
  const order = defs.map((d) => d.id);
  const [focused, setFocused] = useState<ProcessId>(order[0] ?? "backend");
  const [scrollOffset, setScrollOffset] = useState(0);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const ackRef = useRef<Partial<Record<ProcessId, number>>>({});

  const { statuses, alerts, alertCounts } = useProcessStore(store);
  const { height } = useTerminalDimensions();

  const switchTo = (id: ProcessId): void => {
    setFocused(id);
    setScrollOffset(0);
    ackRef.current[id] = alertCounts[id] ?? 0;
  };

  useKeyboard((key) => {
    if (!active) return;
    const index = order.indexOf(focusedRef.current);
    switch (key.name) {
      case "r": {
        store.supervisor.restart(focusedRef.current);
        break;
      }
      case "tab":
      case "right": {
        switchTo(order[(index + 1) % order.length] ?? focusedRef.current);
        break;
      }
      case "left": {
        switchTo(
          order[(index - 1 + order.length) % order.length] ?? focusedRef.current,
        );
        break;
      }
      case "up": {
        setScrollOffset((o) => o + 1);
        break;
      }
      case "down": {
        setScrollOffset((o) => Math.max(0, o - 1));
        break;
      }
      case "pageup": {
        setScrollOffset((o) => o + 10);
        break;
      }
      case "pagedown": {
        setScrollOffset((o) => Math.max(0, o - 10));
        break;
      }
    }
  });

  // Keep the currently-focused process fully "read" so it never shows unread.
  ackRef.current[focused] = alertCounts[focused] ?? 0;
  const unreadOf = (id: ProcessId): number =>
    Math.max(0, (alertCounts[id] ?? 0) - (ackRef.current[id] ?? 0));

  const alertRows = Math.min(alerts.length, ALERTS_CAPACITY);
  // Budget: header(3) + panel title(1) + alerts(border 2 + rows) + footer(3).
  const logRows = Math.max(3, height - (9 + alertRows + 2));
  const visible = store.windowFor({ id: focused, height: logRows, scrollOffset });
  const following = scrollOffset === 0;
  const focusedLabel =
    defs.find((d) => d.id === focused)?.label ?? focused;

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" flexGrow={1}>
        <box
          border
          borderStyle="single"
          title="processes"
          flexDirection="column"
          width={SIDEBAR_WIDTH}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
        >
          {defs.map((def) => {
            const isFocused = def.id === focused;
            const unread = unreadOf(def.id);
            return (
              <text key={def.id} fg={isFocused ? ACCENT : undefined}>
                {isFocused ? "› " : "  "}
                <span fg={statusColor(statuses[def.id] ?? "stopped")}>●</span>{" "}
                {def.label}
                {unread > 0 ? <span fg="red">{` (${unread})`}</span> : ""}
              </text>
            );
          })}
        </box>

        <box
          border
          borderStyle="single"
          title={`${focusedLabel}  ${following ? "(tail)" : "(scrolled)"}`}
          flexDirection="column"
          flexGrow={1}
          marginLeft={1}
          paddingLeft={1}
          paddingRight={1}
        >
          {visible.length === 0 ? (
            <text fg="gray">Waiting for output...</text>
          ) : (
            visible.map((line, index) => (
              <text key={index} fg={levelColor(line.level)}>
                {line.text || " "}
              </text>
            ))
          )}
        </box>
      </box>

      <box
        border
        borderStyle="single"
        title={`alerts (${alerts.length})`}
        flexDirection="column"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
      >
        {alerts.length === 0 ? (
          <text fg="gray">No warnings or errors yet.</text>
        ) : (
          alerts.slice(0, ALERTS_CAPACITY).map((alert) => (
            <text key={alert.seq}>
              <span fg="gray">{`[${alert.source}] `}</span>
              <span fg={levelColor(alert.level)}>{alert.text}</span>
            </text>
          ))
        )}
      </box>
    </box>
  );
}
