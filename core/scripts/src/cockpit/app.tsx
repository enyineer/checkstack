/** @jsxImportSource @opentui/react */
import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ProcessDef } from "../dev-tui/process-config.ts";
import type { ProcessStore } from "./process-store.ts";
import { CockpitSessionProvider, type CockpitSession } from "./session.ts";
import { DevRunView } from "./views/DevRunView.tsx";
import { PrPreviewView, type PreviewInfo } from "./views/PrPreviewView.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ACCENT } from "./theme.ts";

type View = "dev" | "pr-preview";

/**
 * The cockpit shell: a header with view tabs, the active view, and a footer of
 * key hints. It owns the view selection and the (lifted) preview store so both
 * the dev and preview instances keep running as the user switches tabs. Global
 * keys: 1/2 switch views, Tab cycles, q / Ctrl-C quit.
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
  const [preview, setPreview] = useState<{
    store: ProcessStore;
    info: PreviewInfo;
  } | null>(null);
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      onQuit();
    } else if (key.name === "1") {
      setView("dev");
    } else if (key.name === "2") {
      setView("pr-preview");
    } else if (key.name === "tab") {
      setView((v) => (v === "dev" ? "pr-preview" : "dev"));
    }
  });

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
            <DevRunView store={devStore} defs={devDefs} />
          ) : (
            <PrPreviewView
              store={preview?.store ?? null}
              info={preview?.info ?? null}
              onReady={setPreview}
            />
          )}
        </box>

        <StatusBar
          hints={[
            "1/2 switch view",
            "Tab cycle",
            view === "pr-preview" && !preview
              ? "Space select · Enter start"
              : "",
            "q quit",
          ].filter((h) => h.length > 0)}
        />
      </box>
    </CockpitSessionProvider>
  );
}
