---
"@checkstack/dashboard-frontend": patch
---

Align dashboard system-signal rows. Text (non-link) signals - shown when the
viewer can't open the target - were indented ~0.5rem further right than link
signals, because the link row used a negative horizontal margin (`-mx-2`) to let
its hover background bleed past the text while the text row did not. The text row
now uses the same horizontal box, so link and text signals line up.
