---
title: "Markdown editor"
description: "MarkdownEditor pairs a markdown textarea with a live preview rendered through the same pipeline as the saved content, plus a formatting toolbar."
---

Several surfaces accept markdown from operators - incident and maintenance
status updates and descriptions, announcements. `MarkdownEditor` from
`@checkstack/ui` is the input for all of them: a textarea with a **Preview**
tab and a formatting toolbar, so an author can confirm how their text will
render before saving rather than after the first notification goes out.

## Usage

It is a controlled component - it never owns its value:

```tsx
import { MarkdownEditor } from "@checkstack/ui";

const [message, setMessage] = useState("");

<MarkdownEditor
  id="updateMessage"
  value={message}
  onChange={setMessage}
  placeholder="Describe the status update..."
  rows={3}
/>;
```

| Prop | Default | Purpose |
|------|---------|---------|
| `value` / `onChange` | required | Controlled value. `onChange` receives the string, not an event. |
| `rows` | `4` | Visible rows. Both panes share a height derived from this. |
| `showToolbar` | `true` | Formatting toolbar (bold, italic, link, code, lists, quote). |
| `placeholder`, `id`, `disabled`, `className` | - | As on a plain textarea. |

## The preview renders through the real pipeline

The preview pane renders with `MarkdownBlock` - the same component, remark/rehype
chain and sanitizer that renders the saved content on detail pages and public
status pages.

> [!IMPORTANT]
> Do not render the preview with a second, hand-rolled markdown renderer. A
> preview that can drift from the real render is worse than no preview: it tells
> the author their content is fine when it is not.

## It is not a native form control

`MarkdownEditor` wraps its textarea, so `required` on it does nothing. Gate
submission explicitly instead:

```tsx
<Button type="submit" disabled={isPending || !message.trim()}>
  Save
</Button>
```

## Toolbar behaviour

The toolbar's text transforms live in `MarkdownEditor.logic.ts` as pure
functions over `{ value, selectionStart, selectionEnd }`, so every edge case is
unit-tested without mounting a textarea. Behaviour worth knowing:

- Marks **toggle**. Applying bold to already-bold text unwraps it rather than
  producing `****text****`.
- Mark lengths are matched exactly, so italic (`*`) never claims bold's (`**`)
  delimiters and silently downgrade an author's emphasis.
- Line actions (lists, quote) expand a partial selection to whole lines.
- Numbered lists renumber from 1 on every application, so reordering lines and
  re-applying always yields a correct sequence.
- With nothing selected, a mark inserts a placeholder and selects it, so the
  author types straight over it.

## Rendering the saved value: `MarkdownBlock`, not `Markdown`

Whatever an editor saved is authored prose, so render it with `MarkdownBlock`.
The inline `Markdown` is a different component for a different job: it maps
every paragraph to a `<span>` and registers no heading, list, blockquote,
table, or code-block renderers at all.

```tsx
// Authored content - headings, lists, several paragraphs.
<MarkdownBlock size="sm" resolveMention={resolveMention}>
  {update.message}
</MarkdownBlock>
```

> [!WARNING]
> Reaching for the inline `Markdown` here fails in a way that is easy to miss in
> review: nothing errors, the text is all present, and a single short line looks
> identical. It only breaks once someone authors real structure - and because
> the preview above renders through `MarkdownBlock`, the author is told their
> formatting is fine while the saved page silently flattens it.

Reserve the inline `Markdown` for genuinely inline spots - a summary inside a
table cell, a label, a compact list row - where a block element would break the
layout.

## Where it is used

Incident and maintenance update forms, incident and maintenance descriptions,
and the announcement message. Any new field whose content is later passed to
`Markdown` or `MarkdownBlock` should use it too - a markdown field with no
preview is the gap this component closes.
