---
"@checkstack/ai-common": minor
"@checkstack/ai-backend": minor
---

feat(ai): add a docs sitemap and stop the assistant looping on doc search

On an under-documented conceptual question the assistant burned dozens of tool
calls re-running near-identical `searchDocs` queries: the BM25 ranker returns
hits for any query that shares a common word ("system", "health"), so "nothing
found" never looked like nothing, and the model had no map of what pages exist.

Two changes:

- **New `ai.listDocs` tool** returns the documentation sitemap (every page's
  slug, title, description; optional `section` filter). The model can see what
  IS and ISN'T documented and jump straight to the right page with `getDoc`,
  instead of fuzzing `searchDocs` - and when no page fits, conclude the docs do
  not cover the topic.
- **`ai.searchDocs` now returns a `note`** alongside the hits: empty results and
  weak-scoring hits tell the model to consult `listDocs` or say the docs do not
  cover it, rather than reword and retry. The system prompt's docs-grounding
  guidance leads with `listDocs` and forbids the re-search loop.

Verified end-to-end: the conceptual question that previously took ~54 calls
(mostly repeated junk searches) now resolves in ~21 distinct, purposeful calls
(sitemap + a handful of distinct page reads) and returns a more precise,
docs-grounded answer.
