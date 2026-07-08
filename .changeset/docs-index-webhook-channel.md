---
"@checkstack/ai-backend": patch
---

Regenerate the AI docs search index to cover the new webhook notification
channel page (stable JSON payload contract, HMAC-SHA256 request signing, and the
SSRF egress guard on user-supplied webhook URLs) and the strategies-page best
practice on guarding user-supplied URLs against SSRF with `validateWebhookUrl`
plus `redirect: "error"`.
