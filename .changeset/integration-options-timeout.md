---
"@checkstack/integration-backend": patch
"@checkstack/integration-jira-backend": patch
---

Bound integration option-resolution with a timeout so an unreachable or hung
integration can no longer wedge a chat turn (stuck "Thinking") or an automation
editor field. The Jira client's REST calls now carry a 10s request timeout
(matching the Teams/Webex actions, which already did), and the
provider-agnostic `resolveOptions` path races every provider resolver against a
12s ceiling so any provider that hangs fails with a clear error instead of
blocking indefinitely.
