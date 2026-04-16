---
"@checkstack/backend-api": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
"@checkstack/auth-github-backend": patch
"@checkstack/auth-credential-backend": patch
"@checkstack/backend": patch
---

Introduce generic "Login Flows" to allow authentication strategies to define their own interaction patterns (form, redirect, or oauth) during registration. This fixes an issue where LDAP login attempts were incorrectly routed through the standard social login flow by instead providing a dedicated credential collection form for LDAP.
