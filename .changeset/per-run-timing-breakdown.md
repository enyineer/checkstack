---
"@checkstack/healthcheck-common": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/ui": minor
"@checkstack/healthcheck-http-backend": minor
"@checkstack/healthcheck-tls-backend": minor
"@checkstack/healthcheck-tcp-backend": minor
"@checkstack/healthcheck-dns-backend": minor
"@checkstack/healthcheck-mysql-backend": minor
"@checkstack/healthcheck-postgres-backend": minor
"@checkstack/healthcheck-redis-backend": minor
"@checkstack/healthcheck-ssh-backend": minor
"@checkstack/healthcheck-grpc-backend": minor
"@checkstack/healthcheck-jenkins-backend": minor
"@checkstack/healthcheck-rcon-backend": minor
---

Add a finer per-run transport timing breakdown to health checks.

Each run now records an optional structured `metadata.timings` (DNS, connect,
TLS, wait/time-to-first-byte, transfer, and a `processing` catch-all for
non-HTTP operation time). The run-detail view renders the phases it has, in
transport order, and falls back to the previous Connection + Processing split
for older runs that lack the finer data.

For HTTP the request is issued verbatim through `fetch` (original URL, headers,
and body), so request behavior is identical to a plain `fetch`. The timing is
measured around it: `fetch` resolves at the response headers, so wait
(time-to-first-byte) and transfer (body) are measured exactly on the request,
DNS is timed at the resolve step, and connect/TLS come from a short-lived,
best-effort raw `net`/`tls` probe to the same already-validated IP (the request
socket exposes no connect/handshake events on the Bun runtime). The probe is
timing-only and never fails the check. Other transports surface the connect and
operation times they already measure.

The SSRF guard now validates the resolved host (rejecting cloud-metadata /
link-local and operator-denied ranges) as a pre-flight check and no longer pins
the request to the resolved IP. Pinning rewrote the URL to the IP literal and
moved the host to the `Host` header, which breaks HTTP/2 origins (their
authority comes from the URL's `:authority`, not `Host`) - that is why real
hosts such as `google.com` started answering 404/429 instead of 200. The
pre-flight validation keeps blocking static metadata/link-local targets and
direct denied IP literals; the only thing dropped is DNS-rebind TOCTOU
protection (a narrow window that pinning closed at the cost of breaking
legitimate HTTP/2 requests).

The run-detail "slowest" badge no longer collides with the timing bar, and a
genuinely sub-millisecond phase reads as "<1 ms" instead of a bare "0 ms".
