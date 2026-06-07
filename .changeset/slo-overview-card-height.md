---
"@checkstack/slo-frontend": patch
---

fix(slo): stop SLO overview cards stretching to the sidebar height

On the SLO Dashboard the card grid sits next to a taller sidebar in an
`items-stretch` layout, so the card grid was stretched to the sidebar's
height and the default `align-content` then stretched the card rows to fill
it, leaving large empty space inside each card. The card grid now uses
`content-start` so rows stay content-sized, while `h-full` on the card/anchor
still makes cards within the same row match each other.
