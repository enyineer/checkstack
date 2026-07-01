import { createContext, useContext } from "react";
import type { ExecRunner } from "./pr-preview/exec.ts";
import type { CockpitArgs } from "./args.ts";

/**
 * Shared, non-React cockpit session: the repo root, the exec runner used for all
 * external commands, the parsed args, and a registry of shutdown handlers so a
 * single quit tears down every supervised instance (dev + preview) regardless of
 * which view is mounted.
 */
export interface CockpitSession {
  readonly repoRoot: string;
  readonly exec: ExecRunner;
  readonly args: CockpitArgs;
  registerShutdown(fn: () => Promise<void>): void;
  shutdownAll(): Promise<void>;
}

export function createCockpitSession({
  repoRoot,
  exec,
  args,
}: {
  repoRoot: string;
  exec: ExecRunner;
  args: CockpitArgs;
}): CockpitSession {
  const handlers = new Set<() => Promise<void>>();
  return {
    repoRoot,
    exec,
    args,
    registerShutdown(fn) {
      handlers.add(fn);
    },
    async shutdownAll() {
      await Promise.all(
        [...handlers].map((fn) => fn().catch(() => {})),
      );
    },
  };
}

const SessionContext = createContext<CockpitSession | null>(null);
export const CockpitSessionProvider = SessionContext.Provider;

export function useCockpitSession(): CockpitSession {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useCockpitSession must be used within a session provider");
  }
  return session;
}
