---
"@checkstack/dependency-frontend": minor
---

Color the whole dependency-map edge by its impact type, not just the arrowhead.
Previously the arrowhead was filled with the impact hex color but the edge line
was colored via a Tailwind `stroke-*` class on React Flow's `BaseEdge`, which
lost to `@xyflow/react`'s default `.react-flow__edge-path` stroke rule at equal
CSS specificity (the selected state needed a `!stroke-primary` override to win).
That made the line's impact ambiguous when several edges fed one system's input.

The edge stroke, its opacity, and the arrowhead marker now come from one pure
`edgeImpactStyle` mapping applied inline, so the whole edge reads a single impact
color (sky/amber/red) end-to-end and matches the legend, with a selected edge
turning the whole line the primary color. No animation was added, so no
performance (`isLowPower`) branch is needed.
