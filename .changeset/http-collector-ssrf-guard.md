---
"@checkstack/backend-api": minor
"@checkstack/healthcheck-http-backend": minor
---

feat(healthcheck-http): SSRF egress guard for the in-process HTTP collector

The HTTP healthcheck strategy runs in-process on the trusted core (whenever a
check is local or not satellite-only), so it now applies a secure-by-default
egress guard before connecting:

- Denies the cloud-metadata + link-local ranges by default (the same
  `ALWAYS_BLOCKED_CIDRS` the script sandbox enforces), so a check can no longer
  be pointed at `http://169.254.169.254/...` to read instance credentials.
- Keeps RFC1918 / internal probing ALLOWED by default (a monitoring tool's job).
- Resolves the target host to IP(s) and checks the CONNECTED IP, pinning the
  request to the validated IP to resist DNS-rebind.
- Operator-extensible: the new optional `egressDenyCidrs` field on the HTTP
  strategy config adds further CIDRs on top of the always-on block.

`@checkstack/backend-api` exports a reusable `resolveAndValidateHost` /
`pinUrlToIp` SSRF guard plus `DEFAULT_EGRESS_DENY_CIDRS`.
