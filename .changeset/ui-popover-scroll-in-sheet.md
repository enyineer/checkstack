---
"@checkstack/ui": minor
---

fix(ui): make Popover/combobox lists scrollable inside a Sheet or Dialog

A `Popover` (and the comboboxes built on it, e.g. the automation trigger Event
picker, the secret-name picker, the package picker) portals its content to
`document.body`. When opened inside a modal `Sheet`/`Dialog`, the dialog's
`react-remove-scroll` scroll-lock blocked wheel/touch scrolling on that
body-portaled content, so a long list's `overflow-y-auto` could not scroll.

`SheetContent` and `DialogContent` now publish their content element through a
`PortalContainerContext`, and `PopoverContent` portals INTO it when present.
That keeps the popover inside the dialog's allowed-scroll subtree, so its lists
scroll again. Radix positions popovers with `position: fixed`, so placement and
clipping are unaffected; outside a Sheet/Dialog the popover still portals to
`body` as before.
