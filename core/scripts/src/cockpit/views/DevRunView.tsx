/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from "react";
import { extractErrorMessage } from "@checkstack/common";
import { createSupervisor } from "../../dev-tui/supervisor.ts";
import { getProcessDefs, type ProcessDef } from "../../dev-tui/process-config.ts";
import { createProcessStore, type ProcessStore } from "../process-store.ts";
import { useCockpitSession } from "../session.ts";
import { installDependencies } from "../install-deps.ts";
import { InstancePanel } from "../components/InstancePanel.tsx";
import { attachBrowserAutoOpen } from "../open-browser.ts";
import { ACCENT } from "../theme.ts";

/** What the App lifts up once the dev instance is running. */
export interface DevInstance {
  store: ProcessStore;
  defs: readonly ProcessDef[];
  unregister: () => void;
}

type Phase =
  | { kind: "preparing"; steps: string[] }
  | { kind: "error"; message: string };

/**
 * The dev-run view: the primary local instance (deps + backend + frontend).
 *
 * Before the processes start it reconciles `node_modules` with the committed
 * lockfile (see {@link installDependencies}) so a developer who just pulled a
 * Renovate lock-file refresh boots against the current dependency set. The
 * install streams progress the same way the PR-preview flow does; once it
 * succeeds the supervisor is created, started, and lifted to the App via
 * `onReady` so its output survives tab switches.
 */
export function DevRunView({
  store,
  defs,
  active,
  onReady,
}: {
  store: ProcessStore | null;
  defs: readonly ProcessDef[] | null;
  active: boolean;
  onReady: (next: DevInstance) => void;
}) {
  const session = useCockpitSession();
  const [phase, setPhase] = useState<Phase>({ kind: "preparing", steps: [] });
  // Guard against duplicate preparation (async effect + re-renders).
  const preparingRef = useRef(false);

  useEffect(() => {
    if (store) return; // already running
    if (preparingRef.current) return;
    preparingRef.current = true;

    const steps: string[] = [];
    const pushStep = (message: string) => {
      steps.push(message);
      setPhase({ kind: "preparing", steps: [...steps] });
    };
    setPhase({ kind: "preparing", steps: [] });

    let cancelled = false;
    void (async () => {
      try {
        const install = await installDependencies({
          exec: session.exec,
          repoRoot: session.repoRoot,
          onStep: pushStep,
        });
        if (cancelled) return;
        if (!install.ok) {
          setPhase({ kind: "error", message: install.reason ?? "install failed" });
          preparingRef.current = false;
          return;
        }

        pushStep("Starting deps + backend + frontend...");
        const nextDefs = getProcessDefs(session.args.devMode);
        const supervisor = createSupervisor({
          cwd: session.repoRoot,
          mode: session.args.devMode,
        });
        const nextStore = createProcessStore(supervisor);
        const unregister = session.registerShutdown(() => supervisor.shutdown());
        attachBrowserAutoOpen({ supervisor });
        nextStore.start();
        onReady({ store: nextStore, defs: nextDefs, unregister });
      } catch (error) {
        if (cancelled) return;
        setPhase({ kind: "error", message: extractErrorMessage(error) });
        preparingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once until running
  }, [store]);

  if (store && defs) {
    return <InstancePanel store={store} defs={defs} active={active} />;
  }

  if (phase.kind === "error") {
    return (
      <box flexDirection="column" paddingLeft={1}>
        <text fg="red">Could not start the dev instance</text>
        <text>{phase.message}</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={1}>
      <text fg={ACCENT}>Starting dev instance</text>
      {phase.steps.map((step, index) => (
        <text key={index} fg="gray">
          {step}
        </text>
      ))}
    </box>
  );
}
