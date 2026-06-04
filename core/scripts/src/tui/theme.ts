/**
 * Theme tokens for the reusable terminal-UI kit. These are plain data (no ink
 * imports) so they can be unit-tested and consumed by any ink component. The
 * CLI can adopt the same kit later by importing {@link defaultTheme}.
 *
 * Color values are ink/chalk color names (resolved by ink at render time),
 * keeping this module dependency-free and DOM-free.
 */

export type TuiLevel = "debug" | "info" | "warn" | "error";
export type TuiStatus = "starting" | "ready" | "errored" | "stopped";

/** Every level maps to exactly one color. */
export type LevelColors = Readonly<Record<TuiLevel, string>>;
/** Every status maps to exactly one color. */
export type StatusColors = Readonly<Record<TuiStatus, string>>;

/** Chrome colors: borders, dimmed labels, and the accent used for focus. */
export interface ChromeColors {
  /** Border color for panels and bordered boxes. */
  readonly border: string;
  /** Dimmed text for chrome / secondary labels. */
  readonly dim: string;
  /** Accent color for the focused tab / highlights. */
  readonly accent: string;
  /** Foreground for ordinary content text. */
  readonly text: string;
}

export interface TuiTheme {
  readonly level: LevelColors;
  readonly status: StatusColors;
  readonly chrome: ChromeColors;
}

/**
 * The default theme: restrained color, dim chrome, bright content. Debug is
 * dimmed gray, info default-ish, warn yellow, error red. Status dots follow the
 * spec: starting yellow, ready green, errored red, stopped dim gray.
 */
export const defaultTheme: TuiTheme = {
  level: {
    debug: "gray",
    info: "white",
    warn: "yellow",
    error: "red",
  },
  status: {
    starting: "yellow",
    ready: "green",
    errored: "red",
    stopped: "gray",
  },
  chrome: {
    border: "gray",
    dim: "gray",
    accent: "cyan",
    text: "white",
  },
};
