import ansiEscapes from "ansi-escapes";

/**
 * Minimal writable sink the alternate-screen controller writes its escape
 * sequences to. `process.stdout` satisfies this; tests pass a fake to capture
 * the exact bytes written without touching a real terminal.
 */
export interface AltScreenStream {
  write(data: string): boolean;
}

export interface AltScreen {
  /** Switch the terminal into the alternate screen buffer (idempotent). */
  enter(): void;
  /** Restore the terminal's main screen buffer + cursor (idempotent). */
  leave(): void;
  /** Whether the alternate buffer is currently active. */
  readonly isActive: boolean;
}

export interface CreateAltScreenInput {
  /** Where to write the control sequences (defaults are wired by the caller). */
  stream: AltScreenStream;
}

/**
 * Controls the terminal's alternate screen buffer, the same mechanism vim and
 * htop use: the TUI owns a clean, terminal-sized viewport that never scrolls
 * the user's shell and leaves no artifacts on exit.
 *
 * `enter()` switches to the alternate buffer and hides the cursor; `leave()`
 * shows the cursor and switches back to the main buffer. Both are idempotent so
 * the controller can be invoked from multiple exit paths (`q`, SIGINT/SIGTERM,
 * a thrown error, normal unmount) without double-toggling or getting the
 * terminal stuck in the alternate buffer.
 *
 * The escape sequences come from `ansi-escapes` (already an ink dependency):
 * `enterAlternativeScreen` is CSI `?1049h`, `exitAlternativeScreen` is CSI
 * `?1049l`.
 */
export function createAltScreen({ stream }: CreateAltScreenInput): AltScreen {
  let active = false;

  return {
    enter(): void {
      if (active) {
        return;
      }
      active = true;
      stream.write(ansiEscapes.enterAlternativeScreen);
      stream.write(ansiEscapes.cursorHide);
    },
    leave(): void {
      if (!active) {
        return;
      }
      active = false;
      stream.write(ansiEscapes.cursorShow);
      stream.write(ansiEscapes.exitAlternativeScreen);
    },
    get isActive(): boolean {
      return active;
    },
  };
}
