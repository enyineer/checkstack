---
"@checkstack/ai-backend": patch
---

Regenerate the docs index for the notification-strategies guide, which now
documents that a user-authored update message is embedded as markdown via
`buildUpdateMessageSuffix` and that active-content safety comes from the
renderer (`markdownToHtml`), not from escaping the notification body.
