/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { createSupervisor } from "../../dev-tui/supervisor.ts";
import { createProcessStore, type ProcessStore } from "../process-store.ts";
import { useProcessStore } from "../hooks.ts";
import { useCockpitSession } from "../session.ts";
import { listOpenPrs, resolvePrSelection, type PrInfo } from "../pr-preview/gh-prs.ts";
import { preparePreview } from "../pr-preview/prepare.ts";
import { buildPreviewProcessDefs } from "../pr-preview/process-defs.ts";
import { PrMultiSelect } from "../components/PrMultiSelect.tsx";
import { ProcessList } from "../components/ProcessList.tsx";
import { LogPane } from "../components/LogPane.tsx";
import { ACCENT } from "../theme.ts";

/** Live details of a running preview instance, surfaced to the user. */
export interface PreviewInfo {
  readonly backendPort: number;
  readonly vitePort: number;
  readonly worktreePath: string;
  readonly mergedPrs: readonly number[];
}

type Phase =
  | { kind: "loading" }
  | { kind: "select"; prs: PrInfo[] }
  | { kind: "preparing"; steps: string[] }
  | { kind: "error"; message: string };

/**
 * The PR-preview flow: pick open PRs, merge them into a throwaway worktree,
 * snapshot the dev database, and boot the merged app as a namespaced secondary
 * instance on random ports. Once running, its {@link ProcessStore} is lifted to
 * the App so it survives tab switches.
 */
export function PrPreviewView({
  store,
  info,
  onReady,
}: {
  store: ProcessStore | null;
  info: PreviewInfo | null;
  onReady: (next: { store: ProcessStore; info: PreviewInfo }) => void;
}) {
  const session = useCockpitSession();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // Guard against duplicate preparation (async effects + re-renders).
  const preparingRef = useRef(false);

  const startPreview = async (selected: PrInfo[]) => {
    if (preparingRef.current) return;
    preparingRef.current = true;
    const steps: string[] = [];
    const pushStep = (message: string) => {
      steps.push(message);
      setPhase({ kind: "preparing", steps: [...steps] });
    };
    setPhase({ kind: "preparing", steps: [] });
    try {
      const result = await preparePreview({
        exec: session.exec,
        repoRoot: session.repoRoot,
        selected,
        namespace: session.args.namespace,
        fresh: session.args.fresh,
        onStep: pushStep,
      });
      if (!result.ok) {
        setPhase({ kind: "error", message: result.reason });
        preparingRef.current = false;
        return;
      }
      pushStep("Starting preview backend + frontend...");
      const defs = buildPreviewProcessDefs({
        backendPort: result.backendPort,
        vitePort: result.vitePort,
        previewDatabaseUrl: result.previewDatabaseUrl,
        namespace: session.args.namespace,
      });
      const supervisor = createSupervisor({
        cwd: result.worktreePath,
        defs,
      });
      const previewStore = createProcessStore(supervisor);
      session.registerShutdown(() => supervisor.shutdown());
      previewStore.start();
      onReady({
        store: previewStore,
        info: {
          backendPort: result.backendPort,
          vitePort: result.vitePort,
          worktreePath: result.worktreePath,
          mergedPrs: selected.map((pr) => pr.number),
        },
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      preparingRef.current = false;
    }
  };

  // On mount (when no preview is running yet): fetch open PRs, and if the caller
  // passed --prs, resolve + prepare immediately; otherwise show the picker.
  useEffect(() => {
    if (store) return; // a preview is already running
    let cancelled = false;
    void (async () => {
      try {
        const prs = await listOpenPrs({ exec: session.exec });
        if (cancelled) return;
        const requested = session.args.prNumbers;
        if (requested && requested.length > 0) {
          const { selected, invalid } = resolvePrSelection({
            requested,
            available: prs,
          });
          if (invalid.length > 0) {
            setPhase({
              kind: "error",
              message: `Not open PRs: ${invalid.join(", ")}. Open PRs: ${prs
                .map((p) => p.number)
                .join(", ")}`,
            });
            return;
          }
          await startPreview(selected);
          return;
        }
        setPhase({ kind: "select", prs });
      } catch (error) {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount
  }, []);

  // Running: a preview instance exists.
  if (store && info) {
    return <RunningPreview store={store} info={info} />;
  }

  if (phase.kind === "loading") {
    return (
      <box flexDirection="column" paddingLeft={1}>
        <text fg={ACCENT}>PR preview</text>
        <text fg="gray">Loading open pull requests...</text>
      </box>
    );
  }

  if (phase.kind === "select") {
    return (
      <box flexDirection="column" paddingLeft={1}>
        <text fg={ACCENT}>Select PRs to preview together</text>
        <text fg="gray">
          Up/Down move · Space toggle · Enter start
        </text>
        <box paddingTop={1}>
          <PrMultiSelect prs={phase.prs} onSubmit={(sel) => void startPreview(sel)} />
        </box>
      </box>
    );
  }

  if (phase.kind === "preparing") {
    return (
      <box flexDirection="column" paddingLeft={1}>
        <text fg={ACCENT}>Preparing preview instance</text>
        {phase.steps.map((step, index) => (
          <text key={index} fg="gray">
            {step}
          </text>
        ))}
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg="red">Preview failed</text>
      <text>{phase.message}</text>
    </box>
  );
}

function RunningPreview({
  store,
  info,
}: {
  store: ProcessStore;
  info: PreviewInfo;
}) {
  const { lines, statuses } = useProcessStore(store);
  const { height } = useTerminalDimensions();
  const rows = [
    {
      id: "backend" as const,
      label: `preview backend :${info.backendPort}`,
      status: statuses.backend ?? ("stopped" as const),
    },
    {
      id: "frontend" as const,
      label: `preview frontend :${info.vitePort}`,
      status: statuses.frontend ?? ("stopped" as const),
    },
  ];
  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text fg={ACCENT}>
        Preview instance (PRs {info.mergedPrs.map((n) => `#${n}`).join(", ")})
      </text>
      <text>
        Open: <span fg="green">{`http://localhost:${info.vitePort}`}</span>
      </text>
      <ProcessList rows={rows} />
      <box paddingTop={1} flexGrow={1}>
        <LogPane lines={lines} visible={Math.max(3, height - 14)} />
      </box>
    </box>
  );
}
