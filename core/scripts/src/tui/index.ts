/**
 * Reusable terminal-UI kit: theme tokens plus thin ink primitives. The kit is
 * self-contained and has a one-way dependency contract (consumers depend on the
 * kit, never the reverse), so the plugin CLI can adopt it without a refactor.
 */
export { defaultTheme } from "./theme.ts";
export type {
  TuiTheme,
  TuiLevel,
  TuiStatus,
  LevelColors,
  StatusColors,
  ChromeColors,
} from "./theme.ts";

export {
  StatusDot,
  Spinner,
  SPINNER_FRAMES,
  LevelText,
  Panel,
  KeyHints,
} from "./components.tsx";
export type {
  StatusDotProps,
  SpinnerProps,
  LevelTextProps,
  PanelProps,
  KeyHintsProps,
  KeyHint,
} from "./components.tsx";
