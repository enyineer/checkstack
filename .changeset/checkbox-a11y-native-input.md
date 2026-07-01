---
"@checkstack/ui": patch
---

Make `Checkbox` an accessible control. It was a bare `<div>` with an `onClick` -
not keyboard-focusable, no `role="checkbox"`/`aria-checked`, and a wrapping
`<label>` could not forward clicks to it (so clicking a row label next to it did
nothing). It now renders a real, transparent, keyboard-focusable native
`<input type="checkbox">` over the styled visual box: Space toggles it, it has a
focus-visible ring, and label clicks work. Fixes multi-select rows (e.g. an
incident/maintenance editor's "Affected Systems") where clicking the system name
failed to toggle selection.
