/// <reference types="vite/client" />
// Guarded accessor for the monaco-vscode editor API. ALL runtime monaco access
// in this package goes through here; direct value imports of
// `@codingame/monaco-vscode-editor-api` elsewhere are banned by lint
// (`no-restricted-imports`) so the guard cannot be bypassed.
//
// Why: `monaco.editor.*` / `monaco.languages.*` functions resolve services via
// `StandaloneServices.get()`, which AUTO-INITIALIZES the monaco-vscode services
// on first use (CodinGame `standaloneServices.js` — `get()` calls `initialize`
// when not yet initialized). `@typefox/monaco-editor-react` tracks its OWN,
// independent init flags; if any `monaco.*` call runs BEFORE the wrapper's init,
// it trips CodinGame's `servicesInitialized` flag and the wrapper's later
// `initialize()` throws "Services are already initialized" — the editor then
// never renders. This is dev-only (production's single mount masked it once),
// and it is exactly the bug this guard prevents from regressing.
//
// In dev, calling any `monaco.editor.*` / `monaco.languages.*` FUNCTION before
// `areVscodeServicesReady()` throws immediately, at the exact call site, with a
// clear message. In production the raw API is returned (zero overhead).

import * as monacoApi from "@codingame/monaco-vscode-editor-api";
import { areVscodeServicesReady } from "./vscodeServicesSignal";

// The namespaces whose functions auto-initialize the services on first use.
const GUARDED_NAMESPACES = new Set(["editor", "languages"]);

// Wrap a namespace so calling any of its functions before services are ready
// throws. Non-function members (enums like `MarkerSeverity`, classes) pass
// through untouched. Returns the same type `T` (the Proxy is invisible to types,
// so call sites still type-check against the real monaco signatures).
const guardNamespace = <T extends object>(ns: T, nsName: string): T =>
  new Proxy(ns, {
    get(target, prop, receiver): unknown {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }
      const fn = value;
      return (...args: unknown[]): unknown => {
        if (!areVscodeServicesReady()) {
          throw new Error(
            `monaco.${nsName}.${prop}() was called before the monaco-vscode ` +
              `services were initialized. That call auto-initializes the ` +
              `services and breaks the editor's @typefox init ("Services are ` +
              `already initialized"), so the editor never renders. Gate it ` +
              `behind \`apiReady\` (the editor's onEditorStartDone) or ` +
              `\`areVscodeServicesReady()\`. See ` +
              `core/ui/src/components/CodeEditor/monacoGuard.ts.`,
          );
        }
        return Reflect.apply(fn, ns, args);
      };
    },
  });

const guardedMonaco: typeof monacoApi = import.meta.env.DEV
  ? new Proxy(monacoApi, {
      get(target, prop, receiver): unknown {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (
          typeof prop === "string" &&
          GUARDED_NAMESPACES.has(prop) &&
          typeof value === "object" &&
          value !== null
        ) {
          return guardNamespace(value, prop);
        }
        return value;
      },
    })
  : monacoApi;

// The guarded runtime value. Consumers import this for runtime monaco access
// and import the TYPE namespace separately, type-only, from
// `@codingame/monaco-vscode-editor-api` (which the lint rule allows).
export { guardedMonaco as monaco };
