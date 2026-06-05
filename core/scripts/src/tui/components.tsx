import React from "react";
import { Box, Text } from "ink";
import { defaultTheme } from "./theme.ts";
import type { TuiLevel, TuiStatus, TuiTheme } from "./theme.ts";

/**
 * Thin, reusable ink primitives built over the theme tokens. These have no
 * dev-TUI-specific knowledge, so the CLI can adopt them later. Each accepts an
 * optional `theme` so callers can override tokens without forking the kit.
 */

export interface StatusDotProps {
  status: TuiStatus;
  theme?: TuiTheme;
}

/** A single colored status dot. */
export function StatusDot({
  status,
  theme = defaultTheme,
}: StatusDotProps): React.ReactElement {
  return <Text color={theme.status[status]}>●</Text>;
}

/** Braille spinner frames (smooth, monospace-safe, single column). */
export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

export interface SpinnerProps {
  /** Monotonic tick; the rendered glyph is `frame % SPINNER_FRAMES.length`. */
  frame: number;
  /** Glyph color (defaults to the chrome accent). */
  color?: string;
  theme?: TuiTheme;
}

/**
 * A controlled spinner: it renders the glyph for the given `frame` and holds no
 * timer itself, so the caller owns the animation cadence (and tests stay
 * deterministic). Pair it with a `setInterval` that bumps `frame`.
 */
export function Spinner({
  frame,
  color,
  theme = defaultTheme,
}: SpinnerProps): React.ReactElement {
  const glyph = SPINNER_FRAMES[
    ((frame % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) %
      SPINNER_FRAMES.length
  ];
  return <Text color={color ?? theme.chrome.accent}>{glyph}</Text>;
}

/** Line-wrapping behavior, mirroring ink's `Text` `wrap` prop. */
export type TextWrap = React.ComponentProps<typeof Text>["wrap"];

export interface LevelTextProps {
  level: TuiLevel;
  children: React.ReactNode;
  theme?: TuiTheme;
  /**
   * Wrapping behavior. Pass `"truncate"` to keep a line to a single visual row
   * (so a fixed-height pane cannot overflow when lines are long).
   */
  wrap?: TextWrap;
}

/** Text colored by log level (debug dimmed, warn yellow, error red). */
export function LevelText({
  level,
  children,
  theme = defaultTheme,
  wrap,
}: LevelTextProps): React.ReactElement {
  return (
    <Text color={theme.level[level]} dimColor={level === "debug"} wrap={wrap}>
      {children}
    </Text>
  );
}

export interface PanelProps {
  title?: string;
  children: React.ReactNode;
  theme?: TuiTheme;
  /** Override the border color (defaults to the chrome border token). */
  borderColor?: string;
  /** Let the panel grow to fill available space in a flex column. */
  flexGrow?: number;
}

/** A bordered box with an optional dim title row. */
export function Panel({
  title,
  children,
  theme = defaultTheme,
  borderColor,
  flexGrow,
}: PanelProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor ?? theme.chrome.border}
      paddingX={1}
      flexGrow={flexGrow}
    >
      {title === undefined ? null : (
        <Box marginBottom={0}>
          <Text color={theme.chrome.dim} bold>
            {title}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  );
}

export interface KeyHint {
  /** The key or key combination, e.g. "q", "Tab", "PgUp". */
  keys: string;
  /** What the key does, e.g. "quit". */
  label: string;
}

export interface KeyHintsProps {
  hints: readonly KeyHint[];
  theme?: TuiTheme;
}

/** A footer row rendering keybinding hints with accent-colored keys. */
export function KeyHints({
  hints,
  theme = defaultTheme,
}: KeyHintsProps): React.ReactElement {
  return (
    <Box>
      {hints.map((hint, index) => (
        <Box key={hint.keys} marginRight={index === hints.length - 1 ? 0 : 2}>
          <Text color={theme.chrome.accent} bold>
            {hint.keys}
          </Text>
          <Text color={theme.chrome.dim}> {hint.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
