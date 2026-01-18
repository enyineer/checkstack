---
"@checkstack/frontend": patch
---

Fixed query retry behavior for 401/403 errors

API calls that return 401 (Unauthorized) or 403 (Forbidden) errors are no longer retried, as these are definitive auth responses that won't succeed on retry. This prevents unnecessary loading states and network requests.
