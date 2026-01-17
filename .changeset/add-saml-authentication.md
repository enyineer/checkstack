---
"@checkstack/auth-saml-backend": minor
"@checkstack/auth-frontend": patch
---

Add SAML 2.0 SSO support

- Added new `auth-saml-backend` plugin for SAML 2.0 Single Sign-On authentication
- Supports SP-initiated SSO with configurable IdP metadata (URL or manual configuration)
- Uses samlify library for SAML protocol handling
- Configurable attribute mapping for user email/name extraction
- Automatic user creation and updates via S2S Identity API
- Added SAML redirect handling in LoginPage for seamless SSO flow
