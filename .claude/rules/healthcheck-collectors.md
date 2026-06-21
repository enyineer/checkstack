# Health-check collectors: transport failure vs assertable metric

A health-check **collector** (and the transport client its strategy builds)
MUST fail **only when the transport itself failed** - i.e. the probe could not
complete. It MUST NOT fail because a successfully-received application result was
"not what you hoped". This is a hard correctness rule for every collector under
`plugins/healthcheck-*-backend` and `plugins/collector-*-backend`.

## How the run executor reads a collector's outcome

`core/healthcheck-backend`'s queue executor turns a collector result into a
health status:

- The collector **threw**, or returned a non-empty `error` field => the run is
  treated as a **transport failure** and short-circuits to `unhealthy` BEFORE
  assertions run.
- The collector returned a `result` with no `error` => **transport success**.
  The run's health is then decided by the per-collector **assertions** against
  the result fields (`evaluateAssertions`), or - with no assertions - defaults
  to `healthy`.

So `CollectorResult.error` is reserved for "the probe could not complete".
Everything the server actually told you is a **metric the user asserts on**.

## MUST: only genuine transport failures fail the collector

Set `error` / throw ONLY for:

- Connection refused, host unreachable, DNS resolution failure.
- TCP / TLS connect failure, or a TLS **handshake that cannot complete**.
- Timeout / aborted request; the probe could not finish.
- A protocol-level error that prevented getting a result at all.
- A process / script that could not be spawned.
- A config error that prevents the probe from running (e.g. an un-renderable
  URL, or an input that fails a security guard).

## MUST NOT: never fail the collector on an application result

Record these in `result` and let assertions decide health - NEVER set `error`:

- HTTP `statusCode` / `statusText` - a 404 or 500 is a **completed** request.
- gRPC health `status` enum / `serving` - `NOT_SERVING` is a completed RPC.
- SQL `rowCount` - 0 rows (or N rows) is a successful query.
- SSH / shell `exitCode` / `success` - a non-zero exit is a completed command.
- TLS `daysRemaining` / `valid` / `isSelfSigned` - the handshake completed.
- Redis / RCON returned values - an unexpected value is a completed command.
- Jenkins `offlineNodes`, build results, queue depth - the API call succeeded.

A metric merely looking "abnormal" must NEVER fail a collector. Abnormality is
handled by **assertions** and, separately, by the **anomaly engine** - not by
the collector hard-failing.

> [!NOTE]
> An exception: a user-authored script that EXPLICITLY RETURNS its own verdict
> (e.g. the inline-script collector's `{ success: false, message }`) is the
> user's own assertion logic, not the collector second-guessing an application
> result. That returned verdict may map to `error`. A raw shell exit code is
> NOT such a verdict - expose it as the `exitCode` / `success` metric instead.

## When adding or reviewing a collector

- Make sure the strategy's `TransportClient.exec` only throws / surfaces `error`
  for transport failures (above), and returns received-but-non-OK results as a
  normal result.
- Make sure the collector forwards ONLY a real transport `error` and puts every
  status code / exit code / row count / cert property / returned value into
  `result` as an assertable, chart-annotated metric.
- Add a regression test proving the corrected semantics: e.g. "HTTP 404 is a
  successful collection with `statusCode` exposed and no `error`, and a
  `statusCode equals 404` assertion passes". Cover the transport-failure path
  too (timeout / connect error DOES set `error`).

Full rationale and examples:
`docs/src/content/docs/developer-guide/backend/healthchecks/collectors.md`
(section "Transport failure vs assertable metric").
