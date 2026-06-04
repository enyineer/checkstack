// Lightweight, Monaco-free signal for the one-time "monaco-vscode services
// ready" transition.
//
// Extracted from `monacoTsService` so consumers that only need to OBSERVE
// readiness (the `@checkstack/ui` barrel re-export, the automation editor's
// `ScriptServicesBooter` + headless validator) do NOT transitively pull the
// entire `@codingame/*` Monaco stack into their bundle. Importing this module
// loads zero Monaco code, so pages that never mount an editor (e.g. the login
// page) stay Monaco-free.
//
// Why a global flag at all: the monaco-vscode API initializes globally exactly
// ONCE, and that init is owned by the editor wrapper (`MonacoEditorReactComp`),
// which throws "Services are already initialized" if anything else inits first.
// So the headless validator must NOT touch the worker / models until an editor
// has brought the services up. The editor flips this flag from its
// `onEditorStartDone` (via `markVscodeServicesReady`); the validator checks
// `areVscodeServicesReady()` and otherwise no-ops. Net effect: scripts validate
// once any script editor has been opened this session (covering collapsed cards
// from then on); a never-opened, all-collapsed automation is left to the
// deferred backend typecheck.

let vscodeServicesReady = false;
const servicesReadyListeners = new Set<() => void>();

/** Called by the editor once the monaco-vscode services have initialized. */
export const markVscodeServicesReady = (): void => {
  if (vscodeServicesReady) return;
  vscodeServicesReady = true;
  for (const listener of servicesReadyListeners) listener();
  servicesReadyListeners.clear();
};

/** True once an editor has initialized the monaco-vscode services. */
export const areVscodeServicesReady = (): boolean => vscodeServicesReady;

/**
 * Subscribe to the one-time "services ready" transition. Fires immediately if
 * already ready. Returns an unsubscribe. Lets the headless validator re-run the
 * moment the first editor brings the services up (otherwise a never-edited
 * definition would not re-validate just because a card was opened).
 */
export const onVscodeServicesReady = (listener: () => void): (() => void) => {
  if (vscodeServicesReady) {
    listener();
    return () => {};
  }
  servicesReadyListeners.add(listener);
  return () => servicesReadyListeners.delete(listener);
};

// ─── Cold-init serialization ─────────────────────────────────────────────────
// monaco-vscode services initialize globally exactly once. @typefox's React
// wrapper performs that init when given a `vscodeApiConfig`, and it is
// StrictMode-safe for a SINGLE editor - but two editors mounting at once both
// race the init and corrupt it. So exactly ONE editor claims the cold init and
// mounts (with `vscodeApiConfig`); every other editor waits for
// `areVscodeServicesReady()` before mounting (it then attaches to the
// already-initialized services). The claim is released if the claiming editor
// unmounts before services come up, so a sibling can take over.
let coldInitClaimed = false;

/** First caller (while not ready and unclaimed) gets the cold-init role. */
export const claimColdInit = (): boolean => {
  if (vscodeServicesReady || coldInitClaimed) return false;
  coldInitClaimed = true;
  return true;
};

/** Release the claim if services never came up (claimer unmounted early). */
export const releaseColdInit = (): void => {
  if (!vscodeServicesReady) coldInitClaimed = false;
};
