import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { cn } from "../utils";
import { Textarea } from "./Textarea";
import { MarkdownBlock } from "./Markdown";
import {
  applyMarkdownAction,
  applyMentionSelection,
  findMentionQuery,
  isSameMentionQuery,
  type MarkdownAction,
  type MentionQuery,
} from "./MarkdownEditor.logic";

const TOOLBAR_ACTIONS: {
  action: MarkdownAction;
  label: string;
  icon: typeof Bold;
}[] = [
  { action: "bold", label: "Bold", icon: Bold },
  { action: "italic", label: "Italic", icon: Italic },
  { action: "link", label: "Link", icon: Link2 },
  { action: "code", label: "Code", icon: Code },
  { action: "bulletList", label: "Bulleted list", icon: List },
  { action: "numberedList", label: "Numbered list", icon: ListOrdered },
  { action: "quote", label: "Quote", icon: Quote },
];

/** One option offered in the `#` mention picker. */
export interface MarkdownMentionOption {
  /** Stable key, e.g. `incident/<id>`. */
  key: string;
  /** Primary line - the record's title. */
  label: string;
  /** Secondary line - a type name, a status. */
  description?: string;
  /** The markdown inserted when this option is chosen. */
  markdown: string;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Visible rows in the write pane. The preview matches this height. */
  rows?: number;
  id?: string;
  disabled?: boolean;
  /** Formatting toolbar above the textarea. On by default. */
  showToolbar?: boolean;
  /**
   * Searches for records to mention when the author types `#`.
   *
   * Omit to disable mentions entirely. The host owns the search so this
   * component stays free of any knowledge of what is mentionable.
   */
  onMentionSearch?: (props: {
    query: string;
  }) => Promise<MarkdownMentionOption[]>;
  className?: string;
}

/**
 * Markdown textarea with a live Preview tab and a formatting toolbar.
 *
 * ## Why the preview reuses `MarkdownBlock`
 *
 * The preview renders through the SAME component (and therefore the same
 * remark/rehype chain and the same sanitizer) that renders the saved content
 * everywhere else. A second, hand-rolled renderer here would be free to drift,
 * and a preview that disagrees with the real render is worse than no preview -
 * it tells the author their content is fine when it is not.
 *
 * ## Height
 *
 * Both panes share a `min-height` derived from `rows`, so switching tabs does
 * not resize the surrounding form. Without it, previewing a one-line update
 * collapses the field and everything below it jumps.
 *
 * The container carries its own opaque background: it is mounted on detail
 * pages that render a decorative grid backdrop, which would otherwise bleed
 * through the content.
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder,
  rows = 4,
  id,
  disabled = false,
  showToolbar = true,
  onMentionSearch,
  className,
}) => {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [mentionTrigger, setMentionTrigger] = useState<MentionQuery | null>(
    null,
  );
  const [mentionOptions, setMentionOptions] = useState<MarkdownMentionOption[]>(
    [],
  );
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  // Roughly one line per row plus the textarea's own padding. Approximate on
  // purpose - it only has to stop the layout jumping, not match to the pixel.
  const minHeight = `${rows * 1.5 + 1}rem`;

  /**
   * Re-evaluate the `#` trigger after any caret or value change.
   *
   * Bails out when NOTHING changed, which is load-bearing rather than an
   * optimisation. This runs on every `keyup`, including the arrow keys the open
   * picker already handled in `keydown`; unconditionally resetting `highlighted`
   * there snapped the selection back to the first option on every arrow press,
   * so the picker could not be navigated by keyboard at all and Enter always
   * chose the first suggestion. Holding the trigger's identity stable also stops
   * the search effect re-firing on keystrokes that did not change the query.
   */
  const lastTriggerRef = useRef<MentionQuery | null>(null);
  const syncMentionTrigger = useCallback(
    (nextValue: string) => {
      if (!onMentionSearch) return;
      const textarea = textareaRef.current;
      if (!textarea) return;

      const next =
        findMentionQuery({
          value: nextValue,
          caret: textarea.selectionStart,
        }) ?? null;
      const previous = lastTriggerRef.current;

      if (isSameMentionQuery({ a: previous, b: next })) return;

      lastTriggerRef.current = next;
      setMentionTrigger(next);
      // A DIFFERENT query means a different list, so the old highlight index no
      // longer refers to the same thing.
      setHighlighted(0);
    },
    [onMentionSearch],
  );

  // Run the search whenever the active query changes. The stale-response guard
  // matters because a fast typist can outrun an in-flight search, and a late
  // response would otherwise replace the list for a query they have moved past.
  useEffect(() => {
    if (!onMentionSearch || mentionTrigger === null) {
      setMentionOptions([]);
      return;
    }

    let cancelled = false;
    void onMentionSearch({ query: mentionTrigger.query })
      .then((options) => {
        if (!cancelled) setMentionOptions(options);
      })
      .catch(() => {
        // A failed lookup shows no suggestions rather than a broken picker.
        if (!cancelled) setMentionOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [onMentionSearch, mentionTrigger]);

  const acceptMention = (option: MarkdownMentionOption) => {
    const textarea = textareaRef.current;
    if (!textarea || !mentionTrigger) return;

    const next = applyMentionSelection({
      selection: {
        value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      },
      trigger: mentionTrigger,
      markdown: option.markdown,
    });

    onChange(next.value);
    setMentionTrigger(null);
    setMentionOptions([]);

    globalThis.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const pickerOpen = mentionTrigger !== null && mentionOptions.length > 0;

  /**
   * Arrow/Enter/Escape are intercepted ONLY while the picker is open, so normal
   * textarea editing (newlines especially) is untouched the rest of the time.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!pickerOpen) return;

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % mentionOptions.length);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setHighlighted(
          (index) =>
            (index - 1 + mentionOptions.length) % mentionOptions.length,
        );
        break;
      }
      case "Enter":
      case "Tab": {
        event.preventDefault();
        const option = mentionOptions[highlighted];
        if (option) acceptMention(option);
        break;
      }
      case "Escape": {
        event.preventDefault();
        setMentionTrigger(null);
        break;
      }
      default: {
        // Every other key is ordinary editing; leave it to the textarea.
        break;
      }
    }
  };

  const runAction = (action: MarkdownAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const next = applyMarkdownAction({
      action,
      selection: {
        value,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      },
    });

    onChange(next.value);

    // Restore the selection AFTER React has written the new value, so the
    // author can keep typing over the placeholder the action just inserted.
    globalThis.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-inset px-2 py-1.5">
        <div
          role="tablist"
          aria-label="Editor mode"
          className="inline-flex items-center gap-0.5"
        >
          {(["write", "preview"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={tab === mode}
              onClick={() => setTab(mode)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium capitalize transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === mode
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Hidden in preview: the actions operate on the textarea's selection,
            which does not exist while the textarea is unmounted. */}
        {showToolbar && tab === "write" && (
          <div className="flex items-center gap-0.5">
            {TOOLBAR_ACTIONS.map(({ action, label, icon: Icon }) => (
              <button
                key={action}
                type="button"
                title={label}
                aria-label={label}
                disabled={disabled}
                // The textarea loses focus (and therefore its selection) on
                // mousedown otherwise, so the action would apply to nothing.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runAction(action)}
                className={cn(
                  "rounded p-1 text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "write" ? (
        <div className="relative">
          <Textarea
            ref={textareaRef}
            id={textareaId}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              syncMentionTrigger(event.target.value);
            }}
            onKeyUp={() => syncMentionTrigger(value)}
            onClick={() => syncMentionTrigger(value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setMentionTrigger(null)}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            className="rounded-none border-0 focus:ring-0"
            style={{ minHeight }}
          />

          {pickerOpen && (
            <ul
              role="listbox"
              aria-label="Mention suggestions"
              className="absolute inset-x-2 bottom-2 z-20 max-h-48 overflow-y-auto rounded-md border border-border bg-card shadow-lg"
            >
              {mentionOptions.map((option, index) => (
                <li key={option.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    // Blur would close the picker before the click landed.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => acceptMention(option)}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-xs transition-colors",
                      index === highlighted
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          className="px-3 py-2 text-sm"
          style={{ minHeight }}
        >
          {value.trim() ? (
            <MarkdownBlock size="sm">{value}</MarkdownBlock>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      )}
    </div>
  );
};
