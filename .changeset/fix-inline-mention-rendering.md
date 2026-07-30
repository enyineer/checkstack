---
"@checkstack/ui": minor
---

Fix cross-entity mentions rendering as dead text everywhere

Inline `#` mentions never became links - not in the admin UI, not on incident or
maintenance detail pages, not anywhere. `react-markdown` blanks any `href` whose
protocol is outside its safe list BEFORE the rehype plugins run, so
`checkstack:maintenance/<id>` reached the anchor renderer as `""`. The renderer
then saw no mention, took the ordinary-link branch, and emitted an `<a>` with no
href.

The failure was invisible: the label still rendered, nothing threw, and the page
looked correct - only the link was missing. Two filters had to be widened, since
either one alone still drops the href:

- `urlTransform` now passes the mention scheme through and defers everything
  else to `defaultUrlTransform`, so `javascript:`/`data:` stay blocked.
- The sanitizer's URL-protocol allow-list gains the same scheme, so it does not
  strip the href immediately afterwards.

The mention href is never emitted to the DOM either way: the anchor renderer
replaces it with a resolved in-app URL or renders plain text.

`Markdown.mentions.test.tsx` pins the whole path from authored markdown to a
rendered anchor, including that an unresolved mention stays plain text and that
`javascript:` is still refused. The e2e that appeared to cover this asserted
`getByRole("link", …).first()`, which matched the "Referenced items" chip - a
plain router link that renders whether or not the inline mention works - so it
passed throughout. It now asserts both links and their hrefs.
