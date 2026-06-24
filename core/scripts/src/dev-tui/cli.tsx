#!/usr/bin/env bun
import React from "react";
import process from "node:process";
import { render } from "ink";
import { App } from "./App.tsx";
import { createAltScreen } from "./alt-screen.ts";
import { createSupervisor } from "./supervisor.ts";
import { runPlainStreaming } from "./plain-runner.ts";
import { createGracefulShutdown } from "./graceful-shutdown.ts";

/**
 * Entry point for the opt-in dev runner (`dev:tui`). On an interactive terminal
 * it renders the ink TUI inside the ALTERNATE SCREEN BUFFER (like vim/htop) so
 * the runner owns a clean, terminal-sized viewport: it never scrolls the user's
 * shell and leaves no scrollback artifacts. When stdout is not a TTY (piped,
 * redirected, CI) it degrades to a plain prefixed-stream runner that does NOT
 * touch the alternate screen, so it never crashes ink's raw-mode requirements.
 */
function main(): void {
  const cwd = process.cwd();
  const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);

  // `preview` (e.g. `bun run preview`) serves the frontend production build via
  // `vite preview` instead of the dev server; everything else runs as `dev`.
  const mode = process.argv.slice(2).includes("preview") ? "preview" : "dev";

  const supervisor = createSupervisor({ cwd, mode });

  if (!isInteractive) {
    runPlainStreaming({
      supervisor,
      onShutdownComplete: () => {
        process.exit(0);
      },
    });
    return;
  }

  const altScreen = createAltScreen({ stream: process.stdout });

  // Guarantee the terminal is restored on EVERY exit path: normal unmount, `q`
  // / Ctrl-C (handled inside the App, which unmounts), an uncaught error, and
  // the OS signals. `leave()` is idempotent, so registering it on several paths
  // is safe and the terminal can never get stuck in the alternate buffer.
  let restored = false;
  const restore = (): void => {
    if (restored) {
      return;
    }
    restored = true;
    altScreen.leave();
  };

  // Every GRACEFUL exit path - ink unmount (`q` or Ctrl-C), SIGINT, SIGTERM -
  // funnels through one handler that tears the supervised children down BEFORE
  // the process dies, so Ctrl-C can never leave a stale backend bound to its
  // port. The shared handler shuts down exactly once (an unmount racing a
  // signal won't double-kill), and always restores the terminal + exits.
  const gracefulExit = createGracefulShutdown({
    shutdown: () => supervisor.shutdown(),
    finalize: () => {
      restore();
      process.exit(0);
    },
  });
  const onUncaught = (error: unknown): void => {
    restore();
    // Surface the failure on the (now restored) main screen before exiting.
    console.error(error);
    process.exit(1);
  };

  process.once("SIGINT", gracefulExit);
  process.once("SIGTERM", gracefulExit);
  process.once("uncaughtException", onUncaught);
  process.once("unhandledRejection", onUncaught);
  // `exit` is the final backstop: even if a path above is missed, the terminal
  // is restored before the process is gone. It must be synchronous.
  process.once("exit", restore);

  altScreen.enter();

  // `exitOnCtrlC: false`: ink must NOT exit on its own when Ctrl-C is pressed.
  // The App's input handler maps Ctrl-C to the same quit() as `q` (which
  // unmounts); letting ink auto-exit would tear the UI down and exit the
  // process before the shutdown above runs, orphaning the backend.
  const instance = render(<App supervisor={supervisor} onQuit={gracefulExit} />, {
    exitOnCtrlC: false,
  });
  void instance.waitUntilExit().then(gracefulExit).catch(onUncaught);
}

main();
