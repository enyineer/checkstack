---
"@checkstack/auth-saml-backend": patch
---

fix(security): bump transitive `@xmldom/xmldom` to `0.8.13` to resolve 4 HIGH-severity CVEs (CVE-2026-41672, -41673, -41674, -41675). Pulled in via `samlify` / `xml-crypto` / `@authenio/xml-encryption`; all consumers already accept the patched range, so re-resolving the lockfile was sufficient.
