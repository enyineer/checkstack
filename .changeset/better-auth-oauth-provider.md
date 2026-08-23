---
"@checkstack/ai-backend": patch
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Upgrade Better Auth to 1.7.1, adopt the OAuth Provider MCP plugin, and enforce
shared PostgreSQL rate limits atomically. Preserve legacy OAuth tables during
the schema migration so existing clients can be re-registered safely.
