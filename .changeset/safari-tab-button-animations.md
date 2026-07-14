---
"@checkstack/ui": patch
---

Fix two Safari-only animation glitches on the `Tabs` buttons.

- Hovering no longer animates the icon later than the label: the icon span
  transitioned `all`, so it re-transitioned the color it inherits from the
  (already transitioning) button - a compounding lag most visible in Safari.
  It now transitions only `transform` (the active scale), so its color moves
  in lockstep with the label.
- The "flash highlight border" now appears only when a tab is actually
  activated (click completed or keyboard-selected), not already on mouse-down.
  Safari applies its focus ring on press; mouse-driven focus is now suppressed
  (keyboard focus rings are unaffected, and the clicked tab is re-focused on
  click so arrow-key navigation continues from it), replaced by a deliberate
  short-lived ring on the activated tab. Also disables the WebKit tap
  highlight on the buttons.
