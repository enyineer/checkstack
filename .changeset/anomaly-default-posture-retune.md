---
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/collector-hardware-backend": patch
---

Retune anomaly-detection defaults across every health-check strategy and the
hardware collector for a low-noise, problem-focused out-of-the-box experience.

The detection engine already learns a per-metric baseline, debounces with a
confirmation window, and applies practical-significance floors. This pass tunes
the per-metric **defaults** so a fresh install alerts only on genuine,
statistically-significant, problem-mapping deviations instead of flooding on
every metric that wiggles. 264 metrics were reviewed:

- **Default-disabled** the high-noise and un-baselineable classes that were
  alerting for no good reason: raw identifiers and counts (status codes, error
  and row counts, build counts, player and executor counts), config echoes and
  near-constants (probe packet counts, CPU core count, total/swap memory),
  payload-size and other run-to-run-volatile values, and deterministic values
  like certificate days-remaining (governed by the check's own static-threshold
  health logic, not statistics). These stay chartable and can be re-enabled per
  field.
- **Hardened** the signals that should alert - latency/response/execution time
  and availability/success/saturation percentages - with confirmation windows
  and absolute + relative floors so brief spikes and sub-threshold jitter no
  longer flap, and prefer percentage metrics over their absolute twins.

No detection-engine or schema changes; only per-metric `x-anomaly-*` defaults.
Users who had opted into any now-disabled metric keep their explicit override.
