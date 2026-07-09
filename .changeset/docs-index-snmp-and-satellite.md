---
"@checkstack/ai-backend": patch
---

Regenerate the AI docs search index to cover the new SNMP health-check page
(strategy/collector config, result metrics, transport-failure vs assertable-metric
semantics, and Counter64 handling) and the rewritten "connect a satellite" step
that sets execution per assignment via Catalog -> system -> Health Checks ->
Execution, rather than on the check template.
