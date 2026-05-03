---
"@checkstack/frontend": patch
---

fix: suggest a `BASE_URL` value derived from the URL the user actually opened on the misconfiguration error screen, instead of always recommending `http://localhost:3000`. Makes the diagnostic actionable when the app is reached over a LAN IP, custom port, or proxied domain.
