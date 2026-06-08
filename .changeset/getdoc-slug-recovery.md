---
"@checkstack/ai-backend": patch
---

Stop the chat assistant from dead-ending on a guessed documentation slug. The
`getDoc` tool now tells the model the slug must come from a `searchDocs` /
`listDocs` result, and when an unknown slug is requested its error names the
closest real pages (matched on the slug's own words) so the model recovers in
one step instead of guessing another slug.
