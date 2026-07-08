---
"@checkstack/notification-discord-backend": minor
"@checkstack/notification-slack-backend": minor
"@checkstack/notification-gotify-backend": minor
"@checkstack/notification-backstage-backend": minor
---

Harden the Discord, Slack, Gotify, and Backstage channels against SSRF. Each
POSTs to a configured arbitrary host (Discord/Slack incoming webhook, Gotify
server URL, Backstage base URL); these now run the shared `validateWebhookUrl`
pre-flight and send with `redirect: "error"` so a receiver cannot
`302`-redirect the request at a blocked host past the pre-flight. The pre-flight
blocks only the classic exfiltration / pivot targets (loopback, `0.0.0.0/8`,
cloud-metadata, link-local, IPv6 ULA) and ALLOWS internal RFC1918 hosts, so
self-hosted internal receivers keep working. Same defense-in-depth already
applied to the Webhook channel. (Pushover, Telegram, Teams, and Webex POST to
hard-coded vendor hosts and are unaffected.)
