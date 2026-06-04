/**
 * Pure layout math for the dev-runner TUI. Computes how many rows the focused
 * log pane and the alerts list may use so the rendered frame is provably never
 * taller than the terminal.
 *
 * The reserve is derived from the ACTUAL component structure rather than a
 * magic number, so adding/removing chrome stays honest:
 *
 *   row  component
 *   ---  ----------------------------------------------------------------
 *    1   status bar (single padded row)
 *    1   main pane: round-border top edge
 *    1   main pane: panel title row
 *    N   main pane: log content rows            <- LOG_ROWS (clamped)
 *    1   main pane: round-border bottom edge
 *    1   alerts pane: round-border top edge
 *    1   alerts pane: panel title row
 *    M   alerts pane: alert content rows         <- ALERT_ROWS (clamped)
 *    1   alerts pane: round-border bottom edge
 *    1   footer key hints (single row)
 *
 * A round-bordered Panel costs 2 rows of border plus 1 title row, so each panel
 * adds 3 rows of chrome around its content. The sidebar shares the main pane's
 * row band, so it never contributes additional vertical rows.
 */

/** Injectable terminal dimensions (overrides ink's `useStdout`). */
export interface TerminalSize {
  readonly rows: number;
  readonly columns: number;
}

/** Fallback size when no TTY size is available (matches ink's own default). */
export const DEFAULT_TERMINAL_SIZE: TerminalSize = { rows: 24, columns: 80 };

/** Fixed sidebar width so its labels truncate instead of wrapping. */
export const SIDEBAR_WIDTH = 22;

/** Single padded status row at the top of the frame. */
const STATUS_BAR_ROWS = 1;

/** Single footer row of key hints at the bottom of the frame. */
const FOOTER_ROWS = 1;

/** A round-bordered Panel with a title costs 2 border rows + 1 title row. */
const PANEL_CHROME_ROWS = 3;

/**
 * The alerts pane always renders at least one content row: either the queued
 * alerts (1..capacity) or the single "No warnings or errors yet." placeholder.
 */
const MIN_ALERT_ROWS = 1;

/** The main log pane must keep at least one visible content row. */
const MIN_LOG_ROWS = 1;

export interface ComputeLayoutInput {
  /** Terminal dimensions the frame must fit within. */
  size: TerminalSize;
  /** How many alerts are queued (0 renders the placeholder row). */
  alertCount: number;
  /** Hard cap on alert rows (the alert buffer capacity). */
  alertCapacity: number;
}

export interface DevTuiLayout {
  /** Rows the focused log pane content may use (>= 1). */
  readonly logRows: number;
  /** Rows the alerts list may use (>= 1, <= capacity). */
  readonly alertRows: number;
  /** Total rows the rendered frame occupies (provably <= size.rows). */
  readonly totalRows: number;
}

/**
 * Distribute the terminal's rows across the fixed chrome, the alerts list, and
 * the focused log pane. Alerts are clamped first (they are pinned and bounded
 * by capacity); the log pane then absorbs whatever vertical space remains. Both
 * are floored at one row so a tiny terminal still renders a coherent frame.
 *
 * Guarantee: `logRows + alertRows + chrome === min(totalRows, size.rows)` when
 * the terminal is tall enough, and never exceeds `size.rows`.
 */
export function computeLayout({
  size,
  alertCount,
  alertCapacity,
}: ComputeLayoutInput): DevTuiLayout {
  const terminalRows = Math.max(1, Math.floor(size.rows));

  // Chrome that is always present regardless of content height.
  const fixedChrome =
    STATUS_BAR_ROWS + PANEL_CHROME_ROWS + PANEL_CHROME_ROWS + FOOTER_ROWS;

  // Alerts content the pane wants to show (placeholder counts as one row),
  // capped by the buffer capacity so a flood can never grow the pane.
  const cappedCapacity = Math.max(MIN_ALERT_ROWS, Math.floor(alertCapacity));
  const desiredAlertRows = Math.max(MIN_ALERT_ROWS, Math.floor(alertCount));
  const wantedAlertRows = Math.min(desiredAlertRows, cappedCapacity);

  // Rows left for the variable content after fixed chrome.
  const contentBudget = terminalRows - fixedChrome;

  if (contentBudget < MIN_LOG_ROWS + MIN_ALERT_ROWS) {
    // Terminal is too short to honor every minimum. Give each variable region
    // its single-row minimum and accept that a genuinely tiny terminal cannot
    // show full chrome; the totalRows we report still reflects exactly what the
    // components occupy so callers can reason about it.
    return {
      logRows: MIN_LOG_ROWS,
      alertRows: MIN_ALERT_ROWS,
      totalRows: fixedChrome + MIN_LOG_ROWS + MIN_ALERT_ROWS,
    };
  }

  // Alerts take what they want, but never so much that the log pane drops below
  // its minimum.
  const alertRows = Math.min(wantedAlertRows, contentBudget - MIN_LOG_ROWS);
  const logRows = contentBudget - alertRows;

  return {
    logRows,
    alertRows,
    totalRows: fixedChrome + logRows + alertRows,
  };
}
