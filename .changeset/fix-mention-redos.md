---
"@checkstack/common": patch
---

Fix polynomial ReDoS in mention scanning

The mention link pattern allowed a raw `[` inside the label, so a run of `[[[[`
started a label scan at every bracket that could only fail at the closing `](` -
quadratic in the input length (CodeQL `js/polynomial-redos`, HIGH). The
documents scanned are operator-authored incident and maintenance update text, so
the input is genuinely uncontrolled.

Excluding a raw `[` costs nothing: `buildMentionMarkdown` escapes brackets, so a
legitimate mention never contains one - a bracketed title arrives as `\[`, which
the escape branch already matches.

Guarded by a timing regression test. A quadratic pattern still returns the right
answer, just far too slowly, so no correctness test could have caught this.
