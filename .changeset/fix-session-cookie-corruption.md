---
"@checkstack/auth-common": patch
"@checkstack/auth-backend": patch
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
---

Fix session loss for LDAP and SAML authentication strategies

The auth bridge was joining multiple `Set-Cookie` headers into a single comma-separated string, which corrupted cookie attributes. This caused the `session_token` cookie to inherit the 5-minute `maxAge` from the `session_data` cache cookie instead of the intended 7-day expiry. After the cookie expired from the browser, `get-session` returned `null` and all API calls failed with 401.

Changed the `createSession` RPC contract to return `setCookies: string[]` (array) instead of `setCookie: string`, and updated LDAP/SAML consumers to use `Headers.append("Set-Cookie", ...)` to set each cookie as a separate header.
