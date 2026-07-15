---
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
---

Syslog ingestion becomes the platform's first LISTENER source type
(`logstream.syslog`): create a syslog source instance with port/TLS
config and a log-stream binding instead of setting
`CHECKSTACK_LOGSTREAM_SYSLOG_PORT`. The instance binding is the
authorization and routing - no in-message `ckls_` tokens. A TLS
listener validates its cert/key paths at start (a bad path surfaces as
the instance's lastError instead of a silently-dead intake), and a
deployment still setting the removed env var gets an explicit startup
warning pointing at the new source flow.

BREAKING CHANGES (BETA): the env-var syslog listener and its per-message
token resolution are REMOVED from the core (the satellite's edge syslog
receiver keeps the token-prefix protocol unchanged). Recreate any
env-configured syslog intake as a syslog source instance bound to the
target stream.
