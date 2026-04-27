---
"@checkstack/dependency-frontend": minor
---

Improve dependency map directional clarity

- Redesigned system nodes with a split footer bar showing directional dependency counts (`← N used by | depends N →`), making each node self-documenting
- Color-coded connection handles: teal for incoming ("used by") and violet for outgoing ("depends on")
- Fixed invisible edge arrows by implementing custom SVG marker definitions with impact-type-matched colors (sky for informational, amber for degraded, red for critical)
- Updated the legend panel to explain handle colors alongside the existing impact type guide
