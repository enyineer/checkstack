---
"@checkstack/logstream-backend": minor
"@checkstack/logstream-common": minor
"@checkstack/logstream-frontend": minor
---

Hideable log patterns and a severity filter for the Top patterns card.

- A pattern (mined or user-authored) can now be hidden (`setPatternHidden`,
  manage-gated on the stream). A hidden pattern leaves every default listing
  (Top patterns card, explorer pattern picker, Patterns tab default view) and
  its matched lines are NO LONGER stored as raw log lines - while every
  aggregate keeps counting them (severity totals, pattern/variable buckets,
  spike detection, health checks pinned to the pattern), so hiding noise like
  fully-wildcarded access logs never falsifies stream volume or breaks a
  check. The hide flag propagates to every pod's in-memory Drain engine
  (including worker-hosted trees) via the existing patterns-changed broadcast,
  with hydration as the convergence backstop.
- The Patterns tab shows a "Show hidden (N)" toggle revealing hidden patterns
  (dimmed, badged) with a per-row hide/unhide action; unhiding resumes raw
  line storage immediately.
- `listPatterns` accepts `includeHidden` (default false), `bands` (filter by
  the pattern's derived severity band, computed in SQL exactly like the DTO's
  `bandFromSeverityNumber`) and `orderBy: "lastSeenAt" | "totalCount"`.
- The overview's Top patterns card is now severity-filterable via the same
  band pills the explorer uses (extracted into a shared `SeverityBandPills`
  component) and queries `listPatterns` ordered by volume.
