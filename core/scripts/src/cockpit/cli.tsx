#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
import process from "node:process";
import { parseCockpitArgs } from "./args.ts";
import { createBunExec } from "./pr-preview/exec.ts";
import { resolveDbCopyConfig, wipeSnapshot } from "./pr-preview/db-copy.ts";
import { createSupervisor } from "../dev-tui/supervisor.ts";
import { getProcessDefs } from "../dev-tui/process-config.ts";
import { createProcessStore } from "./process-store.ts";
import { createCockpitSession } from "./session.ts";
import { createGracefulShutdown } from "../dev-tui/graceful-shutdown.ts";
import { runPlainDev, runPlainPreview } from "./plain.ts";

/**
 * Cockpit entry point (`bun run dev`). On an interactive terminal it renders the
 * opentui cockpit (dev-run + PR-preview views). When stdout is not a TTY it
 * degrades to a plain prefixed-stream runner - the agent-facing path, driven by
 * flags (`--prs`, `--wipe`, `--fresh`). See `.claude/rules/pr-preview.md`.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseCockpitArgs(argv);
  const repoRoot = process.cwd();
  const exec = createBunExec();

  // `--wipe`: drop the ephemeral preview database and exit (TTY-independent).
  if (args.wipe) {
    const config = resolveDbCopyConfig({
      env: process.env,
      previewDbName: `checkstack_${args.namespace}`,
    });
    await wipeSnapshot({ exec, config });
    process.stdout.write(`Wiped preview database ${config.previewDb}.\n`);
    process.exit(0);
  }

  const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);

  if (!isInteractive) {
    const onShutdownComplete = () => process.exit(0);
    if (args.view === "pr-preview") {
      await runPlainPreview({ repoRoot, args, onShutdownComplete });
    } else {
      runPlainDev({ repoRoot, args, onShutdownComplete });
    }
    return;
  }

  // Interactive: load opentui lazily so the non-TTY path never touches its FFI.
  const { createCliRenderer } = await import("@opentui/core");
  const { createRoot } = await import("@opentui/react");
  const { App } = await import("./app.tsx");

  const session = createCockpitSession({ repoRoot, exec, args });
  const devDefs = getProcessDefs(args.devMode);
  const devSupervisor = createSupervisor({ cwd: repoRoot, mode: args.devMode });
  const devStore = createProcessStore(devSupervisor);
  session.registerShutdown(() => devSupervisor.shutdown());

  const renderer = await createCliRenderer({ exitOnCtrlC: false });

  // Every graceful exit path (q / Ctrl-C inside the app, SIGINT, SIGTERM) funnels
  // through one idempotent handler that tears down all supervised instances
  // BEFORE the process dies, then restores the terminal (renderer.destroy) and
  // exits - so no preview/dev backend is ever orphaned on its port.
  const quit = createGracefulShutdown({
    shutdown: () => session.shutdownAll(),
    finalize: () => {
      renderer.destroy();
      process.exit(0);
    },
  });
  const onUncaught = (error: unknown): void => {
    renderer.destroy();
    console.error(error);
    process.exit(1);
  };
  process.once("SIGINT", quit);
  process.once("SIGTERM", quit);
  process.once("uncaughtException", onUncaught);
  process.once("unhandledRejection", onUncaught);

  createRoot(renderer).render(
    <App
      session={session}
      devStore={devStore}
      devDefs={devDefs}
      onQuit={quit}
    />,
  );
}

void main();
