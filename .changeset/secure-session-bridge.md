---
"@checkstack/auth-common": patch
"@checkstack/auth-backend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
---

Refactor manual session creation to use a secure, bridged oRPC endpoint. This ensures that custom authentication strategies (LDAP, SAML) leverage Better-Auth's native session establishment utilities, including cryptographic signing and reliable cookie attribute management.
