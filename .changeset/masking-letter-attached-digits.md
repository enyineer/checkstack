---
"@checkstack/logstream-backend": minor
---

Stop masking digits that are part of an identifier in the Drain
preprocessor. The number rule masked every digit run as a substring, so
constant names like `S3`, `utf8`, `sha256`, or `TLSv1.2` were wildcarded
("TechDocs S3 router failed" mined as "TechDocs S<*> router failed"). The
rule now only fires after a non-alphanumeric separator (`key=42` -> `key=<*>`,
`db-9` -> `db-<*>`, `took 250ms` -> `took <*>ms` all keep working): a digit
run attached to a preceding letter, or continuing an identifier across a dot,
stays literal. A letter-attached token that genuinely varies across lines
(worker ids, version tags) is still generalized to `<*>` by the Drain tree's
own clustering, which is exactly what it exists for.

BREAKING CHANGES: pattern identity is `sha256(streamId + template)`, so
templates that previously contained a letter-attached wildcard change under
the new masking and are re-mined under a NEW pattern id. The old mined
patterns stop matching and age out normally. User-authored patterns whose
templates contain such a wildcard produced by the old masking (e.g. `S<*>`)
no longer match incoming lines and should be re-authored from a current
line. Health checks referencing an affected pattern will read zero new
occurrences until they are pointed at the re-mined pattern.
