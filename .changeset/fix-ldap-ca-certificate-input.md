---
"@checkstack/auth-ldap-backend": patch
"@checkstack/ui": patch
---

Fix LDAP CA certificate input: The custom CA certificate field was rendered as a single-line password input, which stripped newlines from PEM certificates and caused TLS connection failures ("Failed to connect"). The field now renders as a multi-line secret textarea that properly preserves PEM format while still encrypting the value in storage.
