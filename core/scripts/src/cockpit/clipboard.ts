import { spawn } from "node:child_process";

interface ClipboardCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** Platform clipboard writers, in preference order (first that runs wins). */
function clipboardCandidates(): ClipboardCommand[] {
  if (process.platform === "darwin") {
    return [{ command: "pbcopy", args: [] }];
  }
  if (process.platform === "win32") {
    return [{ command: "clip", args: [] }];
  }
  // Linux/other: Wayland first, then X11 tools.
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

function tryCandidate(
  candidates: ClipboardCommand[],
  index: number,
  text: string,
): void {
  const candidate = candidates[index];
  if (!candidate) return; // no working clipboard tool; silently give up
  try {
    const child = spawn(candidate.command, [...candidate.args], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    // Tool not installed -> fall through to the next candidate.
    child.on("error", () => tryCandidate(candidates, index + 1, text));
    child.stdin?.end(text);
  } catch {
    tryCandidate(candidates, index + 1, text);
  }
}

/**
 * Copy text to the system clipboard, best-effort and non-blocking. Used to
 * auto-copy selected text in the cockpit (opentui captures the mouse, so the
 * terminal's own drag-to-copy is unavailable). Silently no-ops on empty input
 * or when no clipboard tool is available.
 */
export function copyToClipboard(text: string): void {
  if (text.length === 0) return;
  tryCandidate(clipboardCandidates(), 0, text);
}
