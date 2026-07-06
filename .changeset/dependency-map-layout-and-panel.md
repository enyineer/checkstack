---
"@checkstack/dependency-frontend": minor
---

Dependency map layout is now dependency-aware, and system detail pages gain a
read-only up/downstream dependency panel.

The map's automatic layout replaces the old square grid with a layered
(Sugiyama-style) arrangement: upstream systems are placed to the right of the
systems that depend on them, columns are ordered to minimise edge crossings, and
systems with no dependencies are parked off to the side so they never tangle
with the wired graph. Saved positions are still honoured verbatim - only
unplaced boxes are arranged, and when some boxes are already positioned the new
ones drop into a tidy block in the free space below them rather than overlapping
your existing layout.

Two new toolbar controls build on this:

- **Center on box** - select a system, then rebuild the layout around it, with
  everything it depends on fanning out to one side and everything that depends
  on it to the other. Handy when you only care about one central system.
- **Reset layout** - re-arrange every box with the automatic layered layout,
  overriding saved positions.

System detail pages now show a **Dependencies** panel listing what the system
depends on (upstream) and what depends on it (downstream), each neighbour
linking to its own detail page with a live health dot and the edge's impact
severity. The panel is visible to anyone allowed to read the system's
dependencies: holders of the global dependency-map rule, or users who can manage
the system via a team grant - mirroring how map edge editing is gated.
