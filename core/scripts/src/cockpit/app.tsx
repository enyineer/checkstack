/** @jsxImportSource @opentui/react */
import { useRef, useState } from "react";
import {
  useKeyboard,
  useSelectionHandler,
  useTerminalDimensions,
} from "@opentui/react";
import type { ProcessDef } from "../dev-tui/process-config.ts";
import { type ProcessStore } from "./process-store.ts";
import { CockpitSessionProvider, type CockpitSession } from "./session.ts";
import { DevRunView, type DevInstance } from "./views/DevRunView.tsx";
import { PrPreviewView, type PreviewInfo } from "./views/PrPreviewView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import {
  ShutdownScreen,
  type TeardownInstance,
} from "./components/ShutdownScreen.tsx";
import { copyToClipboard } from "./clipboard.ts";
import { ACCENT } from "./theme.ts";

type View = "home" | "dev" | "pr-preview";

interface PreviewInstance {
  store: ProcessStore;
  info: PreviewInfo;
  defs: readonly ProcessDef[];
  unregister: () => void;
}

/**
 * The cockpit shell. NOTHING starts automatically: it opens on a home screen and
 * only boots the dev instance (or the PR-preview flow) when the user asks. Each
 * instance can be stopped independently (`s`) without quitting the cockpit, and
 * both keep running as the user switches views.
 *
 * Global keys: `1` dev, `2` PR preview, `Esc` home, `s` stop the current
 * instance, `q`/Ctrl-C quit. Per-instance keys (Tab/Arrows/scroll/`r`) are
 * handled inside the mounted InstancePanel; the key sets are disjoint.
 */
export function App({
  session,
  onQuit,
}: {
  session: CockpitSession;
  onQuit: () => void;
}) {
  const initialView: View =
    session.args.view === "pr-preview" ? "pr-preview" : "home";
  const [view, setViewState] = useState<View>(initialView);
  const [dev, setDevState] = useState<DevInstance | null>(null);
  const [preview, setPreviewState] = useState<PreviewInstance | null>(null);
  const [quitting, setQuitting] = useState(false);
  const { width, height } = useTerminalDimensions();

  // Refs mirror state so the keyboard handler always reads current values and
  // start/stop are guarded against duplicate invocation.
  const viewRef = useRef(view);
  viewRef.current = view;
  const quittingRef = useRef(quitting);
  quittingRef.current = quitting;
  const devRef = useRef<DevInstance | null>(dev);
  const previewRef = useRef<PreviewInstance | null>(preview);

  const setView = (v: View) => {
    viewRef.current = v;
    setViewState(v);
  };
  const setDev = (v: DevInstance | null) => {
    devRef.current = v;
    setDevState(v);
  };
  const setPreview = (v: PreviewInstance | null) => {
    previewRef.current = v;
    setPreviewState(v);
  };

  // Just reveal the dev view; DevRunView installs dependencies (with progress),
  // then creates + starts the instance and lifts it back via `setDev`. Guarded
  // so a running instance is never re-prepared.
  const startDev = () => {
    setView("dev");
  };

  const stopDev = () => {
    const current = devRef.current;
    if (current) {
      void current.store.supervisor.shutdown();
      current.unregister();
      setDev(null);
    }
    setView("home");
  };

  const stopPreview = () => {
    const current = previewRef.current;
    if (current) {
      void current.store.supervisor.shutdown();
      current.unregister();
      setPreview(null);
    }
    setView("home");
  };

  const quit = () => {
    setQuitting(true);
    onQuit();
  };

  useKeyboard((key) => {
    if (quittingRef.current) return;
    if (key.ctrl && key.name === "c") {
      quit();
      return;
    }
    switch (key.name) {
      case "q": {
        quit();
        break;
      }
      case "1": {
        startDev();
        break;
      }
      case "2": {
        setView("pr-preview");
        break;
      }
      case "escape": {
        setView("home");
        break;
      }
      case "s": {
        if (viewRef.current === "dev") stopDev();
        else if (viewRef.current === "pr-preview") stopPreview();
        break;
      }
      default: {
        break;
      }
    }
  });

  // Auto-copy any selected text (opentui captures the mouse, so the terminal's
  // own drag-to-copy is unavailable).
  useSelectionHandler((selection) => {
    copyToClipboard(selection.getSelectedText());
  });

  if (quitting) {
    const instances: TeardownInstance[] = [];
    if (dev) instances.push({ label: "dev", store: dev.store, defs: dev.defs });
    if (preview) {
      instances.push({
        label: "preview",
        store: preview.store,
        defs: preview.defs,
      });
    }
    return <ShutdownScreen width={width} height={height} instances={instances} />;
  }

  const tab = (id: View, label: string, running: boolean) => (
    <span fg={view === id ? ACCENT : "gray"}>
      {view === id ? `[${label}]` : ` ${label} `}
      {running ? <span fg="green">●</span> : ""}
    </span>
  );

  return (
    <CockpitSessionProvider value={session}>
      <box flexDirection="column" width={width} height={height}>
        <box borderStyle="single" border paddingLeft={1} paddingRight={1}>
          <text>
            <span fg={ACCENT}>Checkstack Cockpit</span> {"  "}
            {tab("home", "Home", false)} {tab("dev", "1 Dev", dev !== null)}{" "}
            {tab("pr-preview", "2 PR Preview", preview !== null)}
          </text>
        </box>

        <box flexGrow={1}>
          {view === "home" ? (
            <HomeView dev={dev !== null} preview={preview !== null} />
          ) : view === "dev" ? (
            <DevRunView
              store={dev?.store ?? null}
              defs={dev?.defs ?? null}
              active
              onReady={setDev}
            />
          ) : view === "pr-preview" ? (
            <PrPreviewView
              store={preview?.store ?? null}
              info={preview?.info ?? null}
              defs={preview?.defs ?? null}
              active
              onReady={setPreview}
            />
          ) : (
            <HomeView dev={dev !== null} preview={preview !== null} />
          )}
        </box>

        <StatusBar hints={hintsFor(view, preview !== null)} />
      </box>
    </CockpitSessionProvider>
  );
}

function hintsFor(view: View, previewRunning: boolean): string[] {
  if (view === "home") {
    return ["1 start/open Dev", "2 PR Preview", "q quit"];
  }
  if (view === "pr-preview" && !previewRunning) {
    return ["Space select · Enter start", "Esc home", "q quit"];
  }
  return [
    "1/2 view",
    "Tab/←→ process · ↑↓/PgUp/PgDn scroll · r restart",
    "s stop · Esc home · q quit",
  ];
}

function HomeView({ dev, preview }: { dev: boolean; preview: boolean }) {
  const dot = (on: boolean) =>
    on ? <span fg="green">● running</span> : <span fg="gray">○ stopped</span>;
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingTop={1}>
      <text fg={ACCENT}>Welcome to the Checkstack developer cockpit</text>
      <box paddingTop={1} flexDirection="column">
        <text>
          {"  "}
          <span fg={ACCENT}>[1]</span> Dev instance {"    "}
          {dot(dev)}
        </text>
        <text>
          {"  "}
          <span fg={ACCENT}>[2]</span> PR preview {"     "}
          {dot(preview)}
        </text>
      </box>
      <box paddingTop={1}>
        <text fg="gray">
          Nothing starts automatically. Press 1 or 2 to begin. Each instance can
          be stopped with `s` without quitting the cockpit.
        </text>
      </box>
    </box>
  );
}
