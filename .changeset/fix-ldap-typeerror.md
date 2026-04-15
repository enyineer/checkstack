---
"@checkstack/auth-backend": patch
---

Fix TypeError in better-auth initialization when LDAP or SAML strategies are enabled. Non-social strategies are now correctly filtered out from the socialProviders configuration, and standard social providers (GitHub) are correctly initialized using their respective factory functions.
