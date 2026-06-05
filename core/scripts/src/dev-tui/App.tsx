import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  defaultTheme,
  KeyHints,
  LevelText,
  Panel,
  Spinner,
  StatusDot,
} from "../tui/index.ts";
import type { KeyHint } from "../tui/index.ts";
import { createAlertBuffer } from "./alert-buffer.ts";
import { createScrollback } from "./scrollback.ts";
import type { ScrollbackLine } from "./scrollback.ts";
import { isAlertLevel } from "./log-level.ts";
import { PROCESS_DEFS } from "./process-config.ts";
import {
  computeLayout,
  DEFAULT_TERMINAL_SIZE,
  SIDEBAR_WIDTH,
} from "./layout.ts";
import type { TerminalSize } from "./layout.ts";
import type { Supervisor } from "./supervisor.ts";
import type { AlertEntry, ProcessId, ProcessStatus } from "./types.ts";

const SCROLLBACK_CAPACITY = 5000;
const ALERTS_CAPACITY = 8;

const KEY_HINTS: readonly KeyHint[] = [
  { keys: "Tab/←→", label: "switch" },
  { keys: "↑↓/PgUp/PgDn", label: "scroll" },
  { keys: "r", label: "restart" },
  { keys: "q/^C", label: "quit" },
];

export interface AppProps {
  supervisor: Supervisor;
  /**
   * Override the terminal size instead of reading ink's `useStdout`. Used by
   * tests to render at a fixed, deterministic viewport; in production the
   * effect below tracks the live stdout size (and its resize events).
   */
  size?: TerminalSize;
  /**
   * Preload a process's scrollback before the first render. `useStdout`-driven
   * state updates and supervisor events do not flush during ink's one-shot
   * `renderToString`, so tests seed the focused pane this way to exercise the
   * height clamp against many long lines deterministically.
   */
  preloadLines?: Partial<Record<ProcessId, readonly ScrollbackLine[]>>;
  /**
   * Override which process is focused on first render. Defaults to the first
   * process def; tests set this to render a flooded pane as the visible one.
   */
  initialFocused?: ProcessId;
  /**
   * Preload the pinned alerts list before the first render. Like
   * `preloadLines`, this lets a one-shot render exercise the alerts clamp
   * (which otherwise only fills via supervisor events that never flush during
   * `renderToString`).
   */
  initialAlerts?: readonly AlertEntry[];
  /**
   * Called when the user quits (`q` / Ctrl-C). The runner passes its graceful
   * shutdown here (kill children -> restore terminal -> exit); the App keeps the
   * shutdown screen on screen for the whole kill window. Falls back to ink's
   * `exit()` when omitted (tests render the App without a runner).
   */
  onQuit?: () => void;
}

/**
 * The main dev-runner TUI. Subscribes to the supervisor's line/status events,
 * keeps a per-process scrollback and a shared alert ring buffer, and renders
 * the status bar, sidebar, main output pane, pinned alerts panel, and footer.
 *
 * All log-processing logic lives in the tested pure modules; this component is
 * a thin renderer over them plus ink layout.
 */
export function App({
  supervisor,
  size,
  preloadLines,
  initialFocused,
  initialAlerts,
  onQuit,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Per-process scrollback buffers (stable across renders). Seeded once from
  // `preloadLines` so a test (or a warm restart) can render with history.
  const scrollbacks = useRef(
    new Map(
      PROCESS_DEFS.map((def) => {
        const scrollback = createScrollback({ capacity: SCROLLBACK_CAPACITY });
        for (const line of preloadLines?.[def.id] ?? []) {
          scrollback.append(line);
        }
        return [def.id, scrollback];
      }),
    ),
  );
  const alerts = useRef(createAlertBuffer({ capacity: ALERTS_CAPACITY }));

  const [focused, setFocused] = useState<ProcessId>(
    initialFocused ?? PROCESS_DEFS[0]?.id ?? "deps",
  );
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statuses, setStatuses] = useState<Record<ProcessId, ProcessStatus>>({
    deps: "starting",
    backend: "starting",
    frontend: "starting",
  });
  const [unread, setUnread] = useState<Record<ProcessId, number>>({
    deps: 0,
    backend: 0,
    frontend: 0,
  });
  const [alertList, setAlertList] = useState<readonly AlertEntry[]>(
    initialAlerts ?? [],
  );
  // A monotonically increasing tick to force re-render when scrollback changes.
  const [, setTick] = useState(0);

  // Shutdown overlay: once the user quits we swap the whole UI for an animated
  // "shutting down" screen and keep it on screen while the runner kills the
  // children. `spinnerFrame` advances on a timer only while shutting down.
  const [shuttingDown, setShuttingDown] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!shuttingDown) {
      return;
    }
    const interval = setInterval(() => {
      setSpinnerFrame((frame) => frame + 1);
    }, 80);
    return () => clearInterval(interval);
  }, [shuttingDown]);

  // The live terminal size. An explicit `size` prop wins (tests); otherwise we
  // seed from ink's stdout and track resize events so the clamp follows the
  // terminal as it grows or shrinks.
  const [liveSize, setLiveSize] = useState<TerminalSize>(() => ({
    rows: size?.rows ?? stdout?.rows ?? DEFAULT_TERMINAL_SIZE.rows,
    columns: size?.columns ?? stdout?.columns ?? DEFAULT_TERMINAL_SIZE.columns,
  }));

  useEffect(() => {
    if (size !== undefined || stdout === undefined) {
      return;
    }
    const onResize = (): void => {
      setLiveSize({
        rows: stdout.rows ?? DEFAULT_TERMINAL_SIZE.rows,
        columns: stdout.columns ?? DEFAULT_TERMINAL_SIZE.columns,
      });
    };
    // Sync once in case the size changed between the initial state and mount.
    onResize();
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [size, stdout]);

  const terminalSize: TerminalSize = size ?? liveSize;

  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  useEffect(() => {
    supervisor.onLine((line) => {
      scrollbacks.current.get(line.source)?.append({
        text: line.text,
        level: line.level,
      });
      if (isAlertLevel(line.level)) {
        alerts.current.push({
          source: line.source,
          level: line.level,
          text: line.text,
          seq: line.seq,
        });
        setAlertList(alerts.current.list());
        if (line.source !== focusedRef.current) {
          setUnread((prev) => ({
            ...prev,
            [line.source]: prev[line.source] + 1,
          }));
        }
      }
      setTick((value) => value + 1);
    });

    supervisor.onStatus(({ id, status }) => {
      setStatuses((prev) => ({ ...prev, [id]: status }));
    });

    supervisor.start();
    // Supervisor lives for the lifetime of the app; subscriptions are not torn
    // down here because unmount means process exit.
  }, [supervisor]);

  const quit = (): void => {
    // Show the shutdown screen, then run teardown. The runner passes
    // `onQuit` = its graceful shutdown (kill children -> restore -> exit), so the
    // animation stays on screen for the whole kill window. Ctrl-C routes here
    // too (ink's exitOnCtrlC is disabled), so it behaves exactly like `q`.
    setShuttingDown(true);
    (onQuit ?? exit)();
  };

  const switchTo = (id: ProcessId): void => {
    setFocused(id);
    setScrollOffset(0);
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  };

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      quit();
      return;
    }
    if (input === "r") {
      supervisor.restart(focusedRef.current);
      return;
    }

    const order = PROCESS_DEFS.map((def) => def.id);
    const currentIndex = order.indexOf(focusedRef.current);

    if (key.tab || key.rightArrow) {
      const next = order[(currentIndex + 1) % order.length] ?? order[0];
      switchTo(next);
      return;
    }
    if (key.leftArrow) {
      const next =
        order[(currentIndex - 1 + order.length) % order.length] ?? order[0];
      switchTo(next);
      return;
    }

    if (key.upArrow) {
      setScrollOffset((offset) => offset + 1);
      return;
    }
    if (key.downArrow) {
      setScrollOffset((offset) => Math.max(0, offset - 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((offset) => offset + 10);
      return;
    }
    if (key.pageDown) {
      setScrollOffset((offset) => Math.max(0, offset - 10));
    }
  });

  // Derive the exact row budget from the real component structure (status bar,
  // both bordered panels, footer) so the frame is provably <= terminal rows.
  const layout = computeLayout({
    size: terminalSize,
    alertCount: alertList.length,
    alertCapacity: ALERTS_CAPACITY,
  });

  // While quitting, replace the whole UI with the animated shutdown screen so
  // the user sees the services being torn down (instead of a frozen frame or a
  // blank terminal) for the kill window.
  if (shuttingDown) {
    return (
      <ShutdownScreen
        width={terminalSize.columns}
        height={layout.totalRows}
        frame={spinnerFrame}
        statuses={statuses}
      />
    );
  }

  // Recomputed every render: the `tick` state bumps on each new line, and the
  // scrollback buffers mutate in place, so memoizing would risk showing stale
  // output. The window slice is a cheap O(height) operation.
  const focusedScrollback = scrollbacks.current.get(focused);
  const visibleLines =
    focusedScrollback?.window({
      height: layout.logRows,
      scrollOffset,
    }) ?? [];

  // Clamp the alerts list to its computed budget (newest-first already), so the
  // pinned pane can never push the footer off-screen.
  const visibleAlerts = alertList.slice(0, layout.alertRows);

  const following = scrollOffset === 0;

  return (
    // Hard-clamp the whole app to the terminal height and clip overflow, so a
    // chatty pane (e.g. backend) can never push the alerts panel or footer
    // off-screen. The middle row flexes to fill and clips; the alerts+footer
    // block is pinned (flexShrink 0).
    <Box
      flexDirection="column"
      width={terminalSize.columns}
      height={layout.totalRows}
      overflow="hidden"
    >
      <StatusBar statuses={statuses} />
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Sidebar focused={focused} statuses={statuses} unread={unread} />
        <Box
          flexDirection="column"
          flexGrow={1}
          marginLeft={1}
          overflow="hidden"
        >
          <Panel
            title={`${labelFor(focused)}  ${following ? "(tail)" : "(scrolled)"}`}
            flexGrow={1}
          >
            {visibleLines.length === 0 ? (
              <Text color={defaultTheme.chrome.dim}>Waiting for output...</Text>
            ) : (
              visibleLines.map((entry, index) => (
                <LevelText
                  key={`${focused}-${index}`}
                  level={entry.level}
                  wrap="truncate"
                >
                  {entry.text || " "}
                </LevelText>
              ))
            )}
          </Panel>
        </Box>
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        <AlertsPanel alerts={visibleAlerts} />
        <Box paddingX={1}>
          <KeyHints hints={KEY_HINTS} />
        </Box>
      </Box>
    </Box>
  );
}

function labelFor(id: ProcessId): string {
  return PROCESS_DEFS.find((def) => def.id === id)?.label ?? id;
}

export interface ShutdownScreenProps {
  width: number;
  height: number;
  frame: number;
  statuses: Record<ProcessId, ProcessStatus>;
}

/**
 * Centered "shutting down" overlay shown while the runner kills the children.
 * Only the long-running services (not the one-shot deps, which are left up) are
 * listed; each shows a spinner until it exits, then a green check.
 *
 * A service counts as stopped once its child has exited — `"stopped"`
 * (signal/clean) OR `"errored"` (non-zero exit). We intentionally KILLED these
 * processes, so a non-zero exit code (dev servers like Vite commonly exit 143/1
 * on SIGTERM) is an expected part of teardown, not a failure: show a check, not
 * a cross, so the user isn't told a normal shutdown went wrong.
 */
export function ShutdownScreen({
  width,
  height,
  frame,
  statuses,
}: ShutdownScreenProps): React.ReactElement {
  const longRunning = PROCESS_DEFS.filter((def) => !def.oneShot);
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box marginBottom={1}>
        <Spinner frame={frame} />
        <Text bold color={defaultTheme.chrome.accent}>
          {" "}
          Shutting down checkstack dev
        </Text>
      </Box>
      <Box flexDirection="column">
        {longRunning.map((def) => {
          const status = statuses[def.id];
          const exited = status === "stopped" || status === "errored";
          return (
            <Box key={def.id}>
              {exited ? (
                <Text color={defaultTheme.status.ready}>✓</Text>
              ) : (
                <Spinner frame={frame} color={defaultTheme.chrome.dim} />
              )}
              <Text color={defaultTheme.chrome.dim}>
                {" "}
                {def.label}
                {exited ? " stopped" : "…"}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

interface StatusBarProps {
  statuses: Record<ProcessId, ProcessStatus>;
}

function StatusBar({ statuses }: StatusBarProps): React.ReactElement {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text bold color={defaultTheme.chrome.accent}>
        checkstack dev
      </Text>
      <Box>
        {PROCESS_DEFS.map((def, index) => (
          <Box key={def.id} marginLeft={index === 0 ? 0 : 2}>
            <StatusDot status={statuses[def.id]} />
            <Text color={defaultTheme.chrome.dim}> {def.id}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

interface SidebarProps {
  focused: ProcessId;
  statuses: Record<ProcessId, ProcessStatus>;
  unread: Record<ProcessId, number>;
}

function Sidebar({
  focused,
  statuses,
  unread,
}: SidebarProps): React.ReactElement {
  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH} flexShrink={0}>
      <Panel title="processes">
        {PROCESS_DEFS.map((def) => {
          const isFocused = def.id === focused;
          const badge = unread[def.id];
          return (
            <Box key={def.id} justifyContent="space-between">
              <Box flexShrink={1}>
                <Text
                  color={
                    isFocused
                      ? defaultTheme.chrome.accent
                      : defaultTheme.chrome.text
                  }
                  bold={isFocused}
                >
                  {isFocused ? "› " : "  "}
                </Text>
                <StatusDot status={statuses[def.id]} />
                <Text
                  color={
                    isFocused
                      ? defaultTheme.chrome.accent
                      : defaultTheme.chrome.text
                  }
                  bold={isFocused}
                  wrap="truncate"
                >
                  {" "}
                  {def.label}
                </Text>
              </Box>
              {badge > 0 ? (
                <Text color={defaultTheme.level.error} bold>
                  {" "}
                  {badge}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Panel>
    </Box>
  );
}

interface AlertsPanelProps {
  alerts: readonly AlertEntry[];
}

function AlertsPanel({ alerts }: AlertsPanelProps): React.ReactElement {
  return (
    <Panel title={`alerts (${alerts.length})`} borderColor={defaultTheme.level.warn}>
      {alerts.length === 0 ? (
        <Text color={defaultTheme.chrome.dim}>
          No warnings or errors yet.
        </Text>
      ) : (
        alerts.map((alert) => (
          <Box key={alert.seq}>
            <Text color={defaultTheme.chrome.dim}>[{alert.source}] </Text>
            <LevelText level={alert.level} wrap="truncate">
              {alert.text}
            </LevelText>
          </Box>
        ))
      )}
    </Panel>
  );
}
