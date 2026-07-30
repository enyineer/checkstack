---
"@checkstack/healthcheck-http-backend": minor
---

Route HTTP health checks through a proxy

HTTP checks gained optional **Proxy URL**, username and password settings, so a
network that requires an outbound proxy (a filtering proxy, an audited egress
gateway) can be monitored through the same path its users take. The proxy URL is
templatable, so one check can use a different proxy per environment, and proxy
credentials are stored as secrets.

Two deliberate consequences, both documented in the field description:

- **The proxy becomes the egress policy boundary for that check.** The SSRF
  denylist is applied to the PROXY host, because that is the only host Checkstack
  connects to, and the target is left for the proxy to resolve. A filtering proxy
  is frequently the only thing that CAN resolve the target (split-horizon DNS),
  so pre-resolving locally would reject valid checks while proving nothing about
  the real egress. A proxy pointed at a denied range is still refused.
- **Connect/TLS timings are omitted for proxied checks.** The probe that measures
  them opens a raw socket to the resolved target, which is a path a proxied
  request never takes; missing data is honest, a direct-connection timing
  reported for a proxied request is not.

A proxy that answers with an error is a COMPLETED request: 407 and 502 surface as
an assertable `statusCode`, not as a transport failure. Only failing to reach the
proxy at all is a transport failure.

**Credentials.** The proxy password is a secret field - encrypted at rest,
redacted in the UI, resolvable as `${{ secrets.NAME }}`, and delivered to a
satellite just in time per run. It is deliberately NOT `{{ }}`-templatable:
secret and template fields are resolved in separate ordered passes and marking a
field both is rejected at plugin load. So the proxy URL can vary per environment
while the credential cannot - documented, and pinned by tests so the
boot-breaking combination cannot be introduced.

**An empty rendered proxy URL means no proxy**, and the target is guarded as
usual. Worth knowing when templating a mandatory proxy: an environment missing
the field degrades to a direct connection rather than to an error.
