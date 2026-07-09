---
title: "Webhook notification channel"
description: "The generic outgoing webhook channel POSTs a stable JSON envelope to a user-supplied URL, guarded against SSRF and optionally HMAC-signed."
---

The `notification-webhook-backend` plugin adds a generic outgoing webhook as a
subscribable notification channel. Each user registers their own HTTPS endpoint,
and Checkstack POSTs a stable JSON envelope to that URL for every notification
they are subscribed to. Because it registers as a standard notification
strategy, it automatically becomes available to every emitter (health checks,
incidents, maintenance, anomalies, ...).

## How it works

The plugin registers a `NotificationStrategy` with
`contactResolution: { type: "user-config", field: "url" }`, so the per-user
`url` field is the delivery contact. On `send()` it validates the URL against
the platform SSRF guard, builds the JSON payload, optionally signs it, and POSTs
it with the shared `postJson` helper.

## Payload contract

The request body is a stable, versioned JSON envelope. Treat it as a public
contract: fields are only ever added, and a breaking change bumps `version`.

```json
{
  "version": 1,
  "timestamp": "2026-07-08T10:00:00.000Z",
  "type": "healthcheck.alert",
  "title": "System health critical: Payments API",
  "body": "Health check **\"HTTP probe\"** on **Payments API** is failing.",
  "importance": "critical",
  "action": { "label": "View failing checks", "url": "https://app/..." },
  "subjects": [
    {
      "kind": "catalog.system",
      "id": "sys-1",
      "name": "Payments API",
      "url": "https://app/sys-1",
      "status": "unhealthy"
    },
    { "kind": "healthcheck.healthcheck", "id": "cfg-9", "name": "HTTP probe" }
  ]
}
```

- `version` - envelope version; switch on it in your receiver.
- `importance` - one of `info`, `warning`, `critical`.
- `action` - optional deep link back into Checkstack.
- `subjects` - the affected entities; `url` and `status` are optional per entry.

## Request signing

When a user sets a **signing secret**, every request carries two headers so the
receiver can verify authenticity and reject replays:

- `X-Checkstack-Timestamp` - seconds since the epoch.
- `X-Checkstack-Signature` - `sha256=<hmac>`, where the HMAC-SHA256 is computed
  over the string `"<timestamp>.<rawBody>"` using the shared secret.

Verify it by recomputing the HMAC over `"<timestamp>.<body>"` with the same
secret and comparing in constant time:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody: string, headers: Record<string, string>, secret: string) {
  const ts = headers["x-checkstack-timestamp"];
  const expected = `sha256=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`;
  const got = headers["x-checkstack-signature"] ?? "";
  return (
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  );
}
```

## SSRF protection

User-supplied URLs are a classic server-side request forgery (SSRF) vector, so
the destination host is validated with the platform egress guard
(`resolveAndValidateHost`) before any request is sent. The channel blocks only
the classic exfiltration / pivot targets: the loopback interface (`127.0.0.0/8`,
`::1/128`), the `0.0.0.0/8` "this host" alias, and the cloud-metadata,
link-local, and IPv6 ULA ranges. Internal RFC1918 (`10/8`, `172.16/12`,
`192.168/16`) and CGNAT (`100.64/10`) hosts are deliberately **allowed**, so a
self-hosted receiver on a private network is a valid target.

The host is resolved to its IP(s), and delivery is refused when ANY resolved
address falls in a denied range - so a public-looking hostname that resolves to
loopback or the metadata endpoint is caught too. Only `http` and `https` URLs
are accepted.

**Redirects are refused.** The guard validates only the originally-supplied
host, so a receiver that answers with a `3xx Location:` pointing at an
internal/metadata host would otherwise bypass it. The request is sent with
`redirect: "error"`, so any redirect fails the delivery closed rather than being
followed.

> [!NOTE]
> The request is still issued against the original URL (DNS is re-resolved by
> `fetch`), leaving a narrow DNS-rebind TOCTOU window. This blocks direct denied
> literals, statically-denied names, and all redirect-based pivots, which are the
> common cases.
