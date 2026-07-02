---
"@checkstack/healthcheck-http-backend": minor
---

Add optional authentication to the HTTP health check strategy. A new
**Authentication** picker (`none` / `basic` / `token`) on the strategy config
sets the outbound `Authorization` header: `basic` sends
`Basic <base64(username:password)>`, `token` sends `Bearer <token>`. Passwords
and tokens are secret fields (encrypted at rest, redacted in the UI). A
collector that sets its own `Authorization` header still takes precedence.
Existing configs are unaffected (`authType` defaults to `none`; no
schema-version bump required).
