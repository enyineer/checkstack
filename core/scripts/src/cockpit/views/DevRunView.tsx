/** @jsxImportSource @opentui/react */
import { useEffect } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { ProcessDef } from "../../dev-tui/process-config.ts";
import type { ProcessStore } from "../process-store.ts";
import { useProcessStore } from "../hooks.ts";
import { ProcessList } from "../components/ProcessList.tsx";
import { LogPane } from "../components/LogPane.tsx";
import { ACCENT } from "../theme.ts";

/**
 * The dev-run view: the primary local instance (deps + backend + frontend),
 * driven by a persistent {@link ProcessStore} so its output survives tab
 * switches. Starts the supervisor on first mount.
 */
export function DevRunView({
  store,
  defs,
}: {
  store: ProcessStore;
  defs: readonly ProcessDef[];
}) {
  useEffect(() => {
    store.start();
  }, [store]);

  const { lines, statuses } = useProcessStore(store);
  const { height } = useTerminalDimensions();

  const rows = defs.map((def) => ({
    id: def.id,
    label: def.label,
    status: statuses[def.id] ?? ("stopped" as const),
  }));

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
      <text fg={ACCENT}>Dev instance</text>
      <ProcessList rows={rows} />
      <box paddingTop={1} flexGrow={1}>
        <LogPane lines={lines} visible={Math.max(3, height - 12)} />
      </box>
    </box>
  );
}
