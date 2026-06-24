import React from "react";
import { Input } from "./Input";
import type { TemplateProperty } from "./CodeEditor";

/**
 * Detect if the cursor sits inside an unclosed `{{` template context.
 *
 * Exported so callers (and tests) can reuse the same detection rules used
 * inside the picker for upstream "show the variable picker" decisions.
 */
export function detectTemplateContext(
  text: string,
  cursorPos: number,
): { isInTemplate: boolean; query: string; startPos: number } {
  const textBefore = text.slice(0, cursorPos);
  const lastOpenBrace = textBefore.lastIndexOf("{{");
  const lastCloseBrace = textBefore.lastIndexOf("}}");

  if (lastOpenBrace !== -1 && lastOpenBrace > lastCloseBrace) {
    return {
      isInTemplate: true,
      query: textBefore.slice(lastOpenBrace + 2),
      startPos: lastOpenBrace,
    };
  }
  return { isInTemplate: false, query: "", startPos: -1 };
}

// ─── Staged-completion contracts ─────────────────────────────────────────

/** A single row offered by a {@link TemplateCompletionProvider}. */
export interface TemplateCompletionItem {
  /** Primary label rendered in the row. */
  label: string;
  /** Right-aligned hint (type / "comparator" / "filter"). */
  detail?: string;
  /** Tooltip + reserved for a future detail surface. */
  description?: string;
  /** Text spliced into the field, replacing `[replaceStart, replaceEnd]`. */
  insertText: string;
  /**
   * Caret position after insertion, relative to the END of `insertText`.
   * `0` (default) lands after the inserted text; negative values move
   * back into it (e.g. `-1` to sit inside a filter's `()`).
   */
  caretOffset?: number;
}

/** What a provider returns for the current cursor position. */
export interface TemplateCompletionResult {
  /** Optional section heading shown above the rows. */
  heading?: string;
  /** Absolute char range in the value replaced when an item is chosen. */
  replaceStart: number;
  replaceEnd: number;
  items: TemplateCompletionItem[];
}

/**
 * Pluggable, context-aware completion. Given the full value + cursor,
 * returns the candidate set (or `null` to hide the popup). When supplied
 * it fully replaces the legacy `templateProperties` `{{`-detection flow —
 * the provider owns deciding when and what to suggest, so it can do
 * staged field → operator → value → filter completion.
 */
export type TemplateCompletionProvider = (args: {
  value: string;
  cursor: number;
}) => TemplateCompletionResult | null;

// ─── Popup placement ─────────────────────────────────────────────────────

/** Default popup height ceiling (px) — matches the prior `max-h-72`. */
const POPUP_MAX_HEIGHT = 288;
/** Smallest popup height (px) we'll shrink to before just overflowing. */
const POPUP_MIN_HEIGHT = 120;

export interface PopupPlacementInput {
  /** Input's top edge, viewport coords (`getBoundingClientRect().top`). */
  inputTop: number;
  /** Input's bottom edge, viewport coords. */
  inputBottom: number;
  /** Input's left edge, viewport coords. */
  inputLeft: number;
  /** Popup's natural rendered width (px). */
  popupWidth: number;
  /** Popup's natural rendered height (px). */
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Gap kept from each viewport edge (px). */
  margin?: number;
}

export interface PopupPlacement {
  /** Open above the input instead of below it. */
  openUp: boolean;
  /** Anchor to the input's right edge instead of its left. */
  alignRight: boolean;
  /** Height ceiling so the list scrolls within the viewport. */
  maxHeight: number;
}

/**
 * Decide where the completion popup should open so it never spills off
 * the viewport. Pure (no DOM) so the edge logic is unit-testable:
 *
 *   - flip **up** when there isn't room below and there's more room above;
 *   - anchor **right** when a left-anchored popup would overflow the
 *     right edge;
 *   - cap the height to the chosen side's available space (clamped to
 *     `[POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT]`).
 */
export function computePopupPlacement({
  inputTop,
  inputBottom,
  inputLeft,
  popupWidth,
  popupHeight,
  viewportWidth,
  viewportHeight,
  margin = 8,
}: PopupPlacementInput): PopupPlacement {
  const spaceBelow = viewportHeight - inputBottom - margin;
  const spaceAbove = inputTop - margin;
  const openUp = spaceBelow < popupHeight && spaceAbove > spaceBelow;
  const alignRight = inputLeft + popupWidth > viewportWidth - margin;
  const available = openUp ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(
    POPUP_MIN_HEIGHT,
    Math.min(POPUP_MAX_HEIGHT, available),
  );
  return { openUp, alignRight, maxHeight };
}

/**
 * Build a minimal field-only provider from a flat `TemplateProperty`
 * list. Fires inside an (un)closed `{{ … }}` block and inserts
 * `{{ path }}`. This is the engine behind the `templateProperties`
 * shorthand — `DynamicForm` / `KeyValueEditor` and other config-field
 * surfaces pass an array and get simple reference insertion without
 * building a grammar-aware provider.
 */
function buildSimpleProvider(
  properties: TemplateProperty[],
): TemplateCompletionProvider {
  return ({ value, cursor }) => {
    const detected = detectTemplateContext(value, cursor);
    if (!detected.isInTemplate) return null;
    const query = detected.query.trim().toLowerCase();
    const matches = properties.filter(
      (prop) =>
        query === "" ||
        `${prop.templateRef ?? prop.path} ${prop.path} ${prop.description ?? ""}`
          .toLowerCase()
          .includes(query),
    );
    if (matches.length === 0) return null;
    return {
      heading: "Fields",
      replaceStart: detected.startPos,
      replaceEnd: cursor,
      items: matches.map((prop) => ({
        label: prop.templateRef ?? prop.path,
        detail: prop.type,
        description: prop.description,
        insertText: `{{${prop.templateRef ?? prop.path}}}`,
      })),
    };
  };
}

/**
 * Whether this field holds a `{{ }}`-rendered TEMPLATE (the default — action
 * config, durations, variables) or a bare EXPRESSION (a condition / `when` /
 * trigger filter). The distinction is invisible from the value alone, so the
 * input surfaces it: an expression must NOT contain `{{ }}` (those are template
 * delimiters and fail to parse at run time), and the input flags that mistake
 * inline instead of waiting for a save-time / run-time error.
 */
export type TemplateValueInputMode = "template" | "expression";

/** Matches either template delimiter — neither belongs in a bare expression. */
const TEMPLATE_DELIMITER_RE = /\{\{|\}\}/;

/**
 * True when the value contains a `{{` or `}}` template delimiter. In an
 * expression field that is always a mistake. Exported so the rule is unit
 * testable and reusable.
 */
export function containsTemplateDelimiters(value: string): boolean {
  return TEMPLATE_DELIMITER_RE.test(value);
}

/** Inline error shown when an expression field wrongly contains `{{ }}`. */
export const EXPRESSION_DELIMITER_ERROR =
  "Expressions reference fields directly. Remove the {{ }} template delimiters (e.g. artifacts.find.issue_search.found != true).";

/** Muted hint shown on focus so authors know an expression takes no `{{ }}`. */
const EXPRESSION_HINT = "Reference fields directly, without {{ }}.";

export interface TemplateValueInputProps {
  /** DOM id forwarded to the underlying input. */
  id?: string;
  /** Current value. */
  value: string;
  /** Called whenever the value changes. */
  onChange: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /**
   * Template (default) vs bare expression. In `expression` mode the input
   * shows a focus hint and flags `{{ }}` delimiters as an inline error.
   */
  mode?: TemplateValueInputMode;
  /**
   * Legacy flat completion: properties offered when the user types `{{`.
   * Each pick inserts `{{ path }}`. Ignored when `completionProvider`
   * is supplied. Omit both to disable autocomplete entirely.
   */
  templateProperties?: TemplateProperty[];
  /**
   * Staged, context-aware completion. Takes precedence over
   * `templateProperties`. The provider decides when to show the popup
   * and what to insert (fields, comparators, enum values, filters).
   */
  completionProvider?: TemplateCompletionProvider;
  /** Optional extra class on the wrapper. */
  className?: string;
  /** Forwarded to the input. */
  disabled?: boolean;
  /** Forwarded to the input. */
  autoFocus?: boolean;
}

/**
 * Single-line input with template autocomplete.
 *
 * Two modes:
 *
 *   - **Provider mode** (`completionProvider` set) — the provider is
 *     consulted on every edit and cursor move and returns a
 *     `{ items, replaceStart, replaceEnd }` result. This powers the
 *     automation editor's staged field → operator → value → filter
 *     completion.
 *   - **Legacy mode** (`templateProperties` set) — typing `{{` pops a
 *     flat list of paths; picking one inserts `{{ path }}`. Still used
 *     by simpler surfaces (e.g. the key/value editor).
 */
export const TemplateValueInput: React.FC<TemplateValueInputProps> = ({
  id,
  value,
  onChange,
  placeholder,
  mode = "template",
  templateProperties,
  completionProvider,
  className,
  disabled,
  autoFocus,
}) => {
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [showPopup, setShowPopup] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [result, setResult] = React.useState<TemplateCompletionResult | null>(
    null,
  );
  // Where the popup opens relative to the input, recomputed from the
  // live viewport so it never spills off-screen near an edge: flip above
  // the input when there's more room there, anchor to the right edge
  // when a left-anchored popup would overflow, and cap the height to the
  // available space (the list scrolls within it).
  const [placement, setPlacement] = React.useState<{
    openUp: boolean;
    alignRight: boolean;
    maxHeight: number;
  }>({ openUp: false, alignRight: false, maxHeight: 288 });

  // Single completion engine: an explicit provider when supplied,
  // otherwise a field-only provider synthesized from templateProperties.
  // Either way the rest of the component renders one code path.
  const provider = React.useMemo<TemplateCompletionProvider | null>(() => {
    if (completionProvider) return completionProvider;
    if (templateProperties && templateProperties.length > 0) {
      return buildSimpleProvider(templateProperties);
    }
    return null;
  }, [completionProvider, templateProperties]);

  const refresh = (nextValue: string, cursorPos: number) => {
    if (!provider) {
      setShowPopup(false);
      return;
    }
    const next = provider({ value: nextValue, cursor: cursorPos });
    setResult(next);
    setShowPopup(next !== null && next.items.length > 0);
    setSelectedIndex(0);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    onChange(newValue);
    refresh(newValue, event.target.selectionStart ?? newValue.length);
  };

  // Re-evaluate when the caret moves without an edit (Left/Right arrows,
  // clicks, focus) — the staged provider's context shifts by cursor
  // position.
  const handleCaretMove = () => {
    if (!provider) return;
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    refresh(value, cursorPos);
  };

  // Keys that drive the popup itself rather than the caret. When the
  // popup is open these are handled in `handleKeyDown` (which calls
  // preventDefault), so their keyup must NOT trigger a refresh — doing
  // so would reset `selectedIndex` to 0 and make Up/Down jump back to
  // the first row.
  const POPUP_NAV_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "Enter",
    "Tab",
    "Escape",
  ]);

  const handleKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (showPopup && POPUP_NAV_KEYS.has(event.key)) return;
    handleCaretMove();
  };

  const applyItem = (item: TemplateCompletionItem) => {
    if (!result) return;
    const newValue =
      value.slice(0, result.replaceStart) +
      item.insertText +
      value.slice(result.replaceEnd);
    onChange(newValue);
    const caret =
      result.replaceStart + item.insertText.length + (item.caretOffset ?? 0);
    setShowPopup(false);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
      // Re-open with the new context so the operator flows field →
      // operator → value without retyping a trigger character.
      refresh(newValue, caret);
    }, 0);
  };

  const items = result?.items ?? [];

  // Bug fix: keep the popup inside the viewport. Measure on open and on
  // resize, then decide vertical flip / horizontal anchor / max height.
  // `useLayoutEffect` runs before paint, so the user never sees the
  // uncapped first frame. Height/width are placement-independent, so the
  // guarded `setPlacement` can't oscillate.
  React.useLayoutEffect(() => {
    if (!showPopup) return;
    const compute = () => {
      const inputEl = inputRef.current;
      const popupEl = popupRef.current;
      if (!inputEl || !popupEl) return;
      const inputRect = inputEl.getBoundingClientRect();
      const popupRect = popupEl.getBoundingClientRect();
      const next = computePopupPlacement({
        inputTop: inputRect.top,
        inputBottom: inputRect.bottom,
        inputLeft: inputRect.left,
        popupWidth: popupRect.width,
        popupHeight: popupRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      setPlacement((prev) =>
        prev.openUp === next.openUp &&
        prev.alignRight === next.alignRight &&
        prev.maxHeight === next.maxHeight
          ? prev
          : next,
      );
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [showPopup, items.length]);

  // Bug fix: keep the highlighted row visible as the operator arrows
  // through a list taller than the popup.
  React.useEffect(() => {
    if (!showPopup) return;
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, showPopup]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPopup || items.length === 0) {
      // Let arrow keys fall through to move the caret; the provider
      // recomputes context on the resulting caret move.
      return;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        break;
      }
      case "Enter":
      case "Tab": {
        event.preventDefault();
        if (items[selectedIndex]) applyItem(items[selectedIndex]);
        break;
      }
      case "Escape": {
        event.preventDefault();
        setShowPopup(false);
        break;
      }
    }
  };

  const handleFocus = () => {
    setFocused(true);
    handleCaretMove();
  };

  const handleBlur = () => {
    setFocused(false);
    // Delay so a click on a popup row registers before unmounting.
    setTimeout(() => setShowPopup(false), 150);
  };

  // Expression fields must not contain `{{ }}` template delimiters. Flag it
  // inline so the author sees it while typing, not only at save / run time.
  const syntaxError =
    mode === "expression" && containsTemplateDelimiters(value)
      ? EXPRESSION_DELIMITER_ERROR
      : undefined;
  const captionId = id ? `${id}-caption` : undefined;
  // Show the muted hint while focused (so it guides without permanently
  // cluttering a form of many fields); the error always shows when present.
  const showHint = mode === "expression" && focused && !syntaxError;

  return (
    <div className={`relative flex-1 ${className ?? ""}`.trim()}>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleCaretMove}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={Boolean(syntaxError)}
        aria-describedby={syntaxError || showHint ? captionId : undefined}
        className="font-mono text-sm"
      />
      {showPopup && items.length > 0 && (
        <div
          ref={popupRef}
          style={{ maxHeight: placement.maxHeight }}
          className={`absolute z-50 min-w-full w-max max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border bg-popover shadow-lg ${
            placement.openUp ? "bottom-full mb-1" : "top-full mt-1"
          } ${placement.alignRight ? "right-0" : "left-0"}`}
        >
          <div className="p-1">
            {result?.heading && (
              <p className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {result.heading}
              </p>
            )}
            {items.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                title={[item.label, item.detail, item.description]
                  .filter(Boolean)
                  .join("  —  ")}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyItem(item);
                }}
                className={`w-full flex items-center justify-between gap-3 px-2 py-1.5 text-xs rounded-sm text-left hover:bg-accent hover:text-accent-foreground ${
                  index === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : ""
                }`}
              >
                {/* Path takes priority and truncates with an ellipsis;
                    the type/detail (which can be a long enum union) is
                    capped and truncated too, with the full text in the
                    row's title tooltip. */}
                <code className="font-mono truncate flex-1 min-w-0">
                  {item.label}
                </code>
                {item.detail && (
                  <span className="shrink truncate max-w-[55%] text-right text-muted-foreground">
                    {item.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {syntaxError ? (
        <p id={captionId} role="alert" className="mt-1 text-xs text-destructive">
          {syntaxError}
        </p>
      ) : (
        showHint && (
          <p id={captionId} className="mt-1 text-xs text-muted-foreground">
            {EXPRESSION_HINT}
          </p>
        )
      )}
    </div>
  );
};
