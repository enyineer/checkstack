/** @jsxImportSource @opentui/react */
import { useEffect } from "react";
import type { ProcessDef } from "../../dev-tui/process-config.ts";
import type { ProcessStore } from "../process-store.ts";
import { InstancePanel } from "../components/InstancePanel.tsx";

/**
 * The dev-run view: the primary local instance (deps + backend + frontend),
 * driven by a persistent {@link ProcessStore} so its output survives tab
 * switches. Starts the supervisor on first mount and renders the full instance
 * panel (sidebar, scrollable focused log, alerts).
 */
export function DevRunView({
  store,
  defs,
  active,
}: {
  store: ProcessStore;
  defs: readonly ProcessDef[];
  active: boolean;
}) {
  useEffect(() => {
    store.start();
  }, [store]);

  return <InstancePanel store={store} defs={defs} active={active} />;
}
