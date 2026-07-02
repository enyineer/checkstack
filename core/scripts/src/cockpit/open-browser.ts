import { spawn } from "node:child_process";
import { stripAnsi } from "../dev-tui/text.ts";
import type { Supervisor } from "../dev-tui/supervisor.ts";

/**
 * Extract the served URL from a vite frontend output line. Vite prints
 * `  ➜  Local:   http://localhost:5173/` once the dev/preview server is
 * listening, so this doubles as a "server is up" signal. Returns the URL (with
 * any trailing slash preserved) or null if the line is not that banner. ANSI is
 * stripped first. Pure and exported for unit testing.
 */
export function extractServedUrl(line: string): string | null {
  const plain = stripAnsi(line);
  const match = /local:\s*(https?:\/\/\S+)/i.exec(plain);
  return match ? match[1] : null;
}

interface OpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** Platform "open a URL in the default browser" commands. */
function openCommand(url: string): OpenCommand {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (process.platform === "win32") {
    // `start` is a cmd builtin; the empty "" is the window title arg.
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * Open a URL in the system default browser, best-effort and non-blocking.
 * Silently no-ops if the platform opener is missing.
 */
export function openBrowser(url: string): void {
  const { command, args } = openCommand(url);
  try {
    const child = spawn(command, [...args], { stdio: "ignore" });
    child.on("error", () => {}); // opener not installed; give up quietly
  } catch {
    // spawn threw synchronously; give up quietly
  }
}

/**
 * Watch a supervisor's frontend output and open its served URL in the browser
 * the first time the vite "Local" banner appears (dev or preview alike). Opens
 * at most once per supervisor, so a later HMR/server restart does not reopen the
 * tab. `open` is injectable for tests.
 */
export function attachBrowserAutoOpen({
  supervisor,
  open = openBrowser,
}: {
  supervisor: Supervisor;
  open?: (url: string) => void;
}): void {
  let opened = false;
  supervisor.onLine((line) => {
    if (opened || line.source !== "frontend") return;
    const url = extractServedUrl(line.text);
    if (url) {
      opened = true;
      open(url);
    }
  });
}
