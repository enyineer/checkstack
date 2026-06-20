---
"@checkstack/healthcheck-http-backend": minor
"@checkstack/healthcheck-grpc-backend": minor
"@checkstack/healthcheck-jenkins-backend": minor
"@checkstack/healthcheck-script-backend": minor
---

Fix collectors hard-failing on successful-but-non-OK application results.

A health-check collector must fail only when the TRANSPORT fails (the probe
could not complete: DNS/connect/TLS failure, timeout, aborted, unspawnable
process). A successfully-received result that is simply "not what you hoped" is
an assertable metric, not a collector failure - the user's assertions (or the
no-assertion default) decide health.

BREAKING CHANGE: checks that previously relied on a collector auto-failing on a
non-OK result will now report healthy unless an explicit assertion is added.
Affected collectors:

- HTTP request collector: a received response (including 4xx/5xx) is now a
  successful collection. `statusCode` / `statusText` / `success` are exposed as
  metrics; the collector no longer sets `error` on a non-2xx. Add a
  `statusCode equals 200` assertion to fail on non-200 (or `statusCode equals
  404` for a check that wants a 404). Only a real transport failure fails the
  collector.
- gRPC health collector: a completed health RPC returning `NOT_SERVING` /
  `SERVICE_UNKNOWN` / `UNKNOWN` is now a successful collection. `serving` /
  `status` are assertable metrics; only a real RPC transport error fails the
  collector.
- Jenkins node-health collector: offline nodes are now an assertable metric
  (`offlineNodes`); a successful all-nodes API call no longer fails the
  collector when some nodes are offline.
- Script (shell) execute collector: a non-zero exit code is now an assertable
  metric (`exitCode` / `success`); the collector no longer hard-fails on a
  non-zero exit. A timeout or a script that could not be spawned still fails the
  collector (those are transport failures). Add a `success is true` (or
  `exitCode equals 0`) assertion to fail on a non-zero exit.

Other strategies (DNS, TCP, TLS, ping, ssh, mysql, postgres, redis, rcon,
hardware, and the inline-script collector) were audited and already failed only
on genuine transport failures.
