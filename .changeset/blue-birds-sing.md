---
"@checkstack/backend": patch
---

Implement a security headers middleware to add `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` to all backend responses. This mitigates clickjacking and MIME sniffing attacks.
