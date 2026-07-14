---
"@checkstack/ai-backend": patch
---

Regenerate the docs index to include the new "Telemetry sources and sinks"
developer-guide page (the platform-level source/sink abstraction, source
types, sinks, RLAC and satellite execution), including the webhook
signature-verification section's note that adding a signature descriptor to an
already-shipped source type requires rotating each existing instance's webhook
secret.
