---
"@checkstack/auth-saml-backend": patch
---

fix(security): override `@xmldom/xmldom` to `^0.8.13` to resolve 4 HIGH-severity CVEs (CVE-2026-41672, -41673, -41674, -41675) pulled in transitively via `samlify` / `xml-crypto` / `@authenio/xml-encryption`.
