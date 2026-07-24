---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Fix custom-domain status pages serving the admin app (or 404) instead of the status page

Thanks to @stuajnht for reporting: a verified, published custom domain loaded the
admin SPA rather than its status page when the deployment sat behind a reverse
proxy or ingress that rewrites the `Host` header to an internal service name and
forwards the original public host as `X-Forwarded-Host`.

The public-host routing match and the `/api/config` origin read the raw `Host`
header, so behind such a proxy they saw the internal service name, never matched
a configured page, and fell through to the admin bundle. The request-origin
derivation already honored `X-Forwarded-Host`, so routing and origin disagreed.

Both now resolve the request host through a single `resolveRequestHost` helper
that reads `X-Forwarded-Host` (first hop) and falls back to `Host`, matching the
request-origin precedence. The routing e2e test previously mirrored the bug (it
read the raw `Host` header too), so it passed while the real path was broken; it
now exercises the `X-Forwarded-Host` case and locks the behaviour in.

Second, the frontend build never emitted the `public.html` the backend serves to
a custom-domain host - so even once routing resolved the host correctly, the SPA
fallback 404'd (`public.html` missing => fail-safe 404). The custom-domain public
bundle has therefore never actually served since it was introduced in #341; it
was only ever exercised via the same-origin `/statuspage/view/:slug` path, which
serves `index.html`. Because `main.tsx` is a single entry that branches to the
lean `PublicApp` at runtime from the `publicHost` the backend inlines, the build
now emits `public.html` as a copy of the built `index.html`, so the custom-domain
navigational route serves the public bundle instead of 404ing. Verified end to
end over real HTTP: a request with `Host: <internal>` + `X-Forwarded-Host:
<custom-domain>` returns 200 with the lean public bootstrap (`publicHost` set,
`enabledPlugins: []`), while the primary host still serves the admin bundle.
