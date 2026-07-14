---
"@checkstack/backend-api": minor
"@checkstack/metricstream-backend": patch
---

Promote the SSRF-guarded, redirect-revalidating fetch into backend-api as
`createGuardedFetch` / `GuardedFetchError`: scheme allow-list, host validation
on EVERY redirect hop, spec-correct redirect semantics (301/302/303 downgrade
to GET and drop the body; 307/308 preserve the method and refuse
non-replayable stream bodies), and `maxRedirects: 0` returning the 3xx as-is
for callers that must not follow.

The Prometheus scrape executor now uses it: previously the scraper validated
only the ORIGINAL host and then followed redirects blindly, so a compliant
target could redirect a scrape to an internal address; every hop is now
re-validated. (The AI probe-url tool and the notification egress validator
deliberately keep their own guards - both are STRICTER than the shared
default: probe-url blocks all private ranges and metadata hostnames by name,
notification egress fails closed on any redirect.)

Credential headers (`authorization`, `proxy-authorization`, `cookie`) are now
stripped from the forwarded request when a redirect crosses to a different
origin (scheme, host, or port), matching browser / undici behavior. Previously
the manual follower re-sent every request header verbatim, so a redirecting
target (e.g. a Prometheus scrape endpoint) could replay the configured bearer
to another host. Same-origin redirects keep the credentials.
