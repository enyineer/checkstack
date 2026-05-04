---
"@checkstack/tips-frontend": minor
---

Redesign `<Tip>` to be user-triggered instead of auto-opening.

A small lightbulb icon is now rendered immediately after the wrapped
element. The popover only opens when the user clicks the lightbulb.
Once the user explicitly dismisses the tip (X, "Got it", or the action
button), the lightbulb disappears for that user (per-user when signed
in, per-browser when anonymous) and only the underlying element is
rendered.

This replaces the previous auto-open behaviour, which was racing with
focus management whenever multiple tips on a page mounted at once
(e.g. the Catalog "Add System" + "Add Group" tips would flash open and
instantly self-close as Radix's outside-focus handler fired). It also
fixes the bug where clicking the anchored button would silently dismiss
the tip — the lightbulb model has no implicit dismissal at all.

The default `align` for the popover changed from `"start"` to `"end"`
so the popover hangs off the lightbulb rather than the larger anchor
to its left. New optional `triggerClassName` prop on `<TipProps>` lets
callers restyle the lightbulb when needed.
