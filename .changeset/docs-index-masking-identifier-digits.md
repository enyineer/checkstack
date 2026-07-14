---
"@checkstack/ai-backend": patch
---

Regenerate the docs index for the updated log-stream masking documentation:
the pattern engine's number rule now keeps letter-attached digits (`S3`,
`utf8`, `sha256`) literal and only masks numbers behind a non-alphanumeric
separator.
