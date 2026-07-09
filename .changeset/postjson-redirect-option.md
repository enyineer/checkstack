---
"@checkstack/notification-backend": minor
---

Add a `redirect` option to the shared `postJson` helper. It defaults to
`"follow"` (unchanged behavior for trusted, admin-configured service endpoints),
but lets callers with a user-supplied destination pass `"error"` so any HTTP
redirect fails closed. This is required to stop an attacker-controlled webhook
receiver from `302`-redirecting a request at an internal/cloud-metadata host
that the pre-flight SSRF guard never validated.

Also export a shared SSRF egress guard, `validateWebhookUrl` (and its
`WEBHOOK_EGRESS_DENY_CIDRS` denylist), so every strategy that POSTs to a
user/admin-supplied URL can reject the classic exfiltration / pivot targets
before dispatch. Policy: block the loopback interface (`127.0.0.0/8`, `::1/128`),
the `0.0.0.0/8` "this host" alias, cloud-metadata, link-local, and IPv6 ULA;
ALLOW internal RFC1918 / CGNAT hosts so self-hosted receivers work. Hoisted from
the webhook plugin so all channels share one implementation.
