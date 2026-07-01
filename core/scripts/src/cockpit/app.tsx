/** @jsxImportSource @opentui/react */
import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ProcessDef } from "../dev-tui/process-config.ts";
import type { ProcessStore } from "./process-store.ts";
import { CockpitSessionProvider, type CockpitSession } from "./session.ts";
import { DevRunView } from "./views/DevRunView.tsx";
import { PrPreviewView, type PreviewInfo } from "./views/PrPreviewView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ShutdownScreen } from "./components/ShutdownScreen.tsx";
import { ACCENT } from "./theme.ts";

type View = "dev" | "pr-preview";

interface PreviewState {
  store: ProcessStore;
  info: PreviewInfo;
  defs: readonly ProcessDef[];
}

/**
 * The cockpit shell: a header with view tabs, the active view, and a footer of
 * key hints. It owns the view selection and the (lifted) preview store so both
 * the dev and preview instances keep running as the user switches tabs.
 *
 * Global keys handled here: `1`/`2` switch views, `q` / Ctrl-C quit. Per-instance
 * keys (Tab/Arrows to switch process, scroll, `r` restart) are handled inside the
 * mounted view's InstancePanel - the key sets are disjoint so both handlers can
 * be live at once.
 */
export function App({
  session,
  devStore,
  devDefs,
  onQuit,
}: {
  session: CockpitSession;
  devStore: ProcessStore;
  devDefs: readonly ProcessDef[];
  onQuit: () => void;
}) {
  const [view, setView] = useState<View>(session.args.view);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [quitting, setQuitting] = useState(false);
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (quitting) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      setQuitting(true);
      onQuit();
    } else if (key.name === "1") {
      setView("dev");
    } else if (key.name === "2") {
      setView("pr-preview");
    }
  });

  if (quitting) {
    return (
      <ShutdownScreen
        width={width}
        height={height}
        devStore={devStore}
        devDefs={devDefs}
        preview={preview}
      />
    );
  }

  const tab = (id: View, label: string) => (
    <span fg={view === id ? ACCENT : "gray"}>
      {view === id ? `[${label}]` : ` ${label} `}
    </span>
  );

  return (
    <CockpitSessionProvider value={session}>
      <box flexDirection="column" width={width} height={height}>
        <box borderStyle="single" border paddingLeft={1} paddingRight={1}>
          <text>
            <span fg={ACCENT}>Checkstack Cockpit</span> {"  "}
            {tab("dev", "1 Dev")} {tab("pr-preview", "2 PR Preview")}
          </text>
        </box>

        <box flexGrow={1}>
          {view === "dev" ? (
            <DevRunView store={devStore} defs={devDefs} active={view === "dev"} />
          ) : (
            <PrPreviewView
              store={preview?.store ?? null}
              info={preview?.info ?? null}
              defs={preview?.defs ?? null}
              active={view === "pr-preview"}
              onReady={setPreview}
            />
          )}
        </box>

        <StatusBar
          hints={[
            "1/2 view",
            view === "pr-preview" && !preview
              ? "Space select · Enter start"
              : "Tab/←→ process · ↑↓/PgUp/PgDn scroll · r restart",
            "q quit",
          ].filter((h) => h.length > 0)}
        />
      </box>
    </CockpitSessionProvider>
  );
}
