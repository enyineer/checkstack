---
"@checkstack/healthcheck-frontend": minor
"@checkstack/logstream-frontend": minor
"@checkstack/logstream-common": minor
---

Render the log-stream health-check config as real dropdowns. The check editor
now forwards dynamic-option resolvers to its strategy and collector config
forms, so the `logstream` strategy's **stream** field and the
`pattern-occurrence` collector's **pattern** field become pickers instead of
plain text inputs.

The health-check editor gains a contribution point,
`HealthCheckConfigOptionsResolverSlot`: a plugin that registers a strategy whose
config declares `x-options-resolver` fields contributes a factory that turns the
editor's generic context (the RPC api plus the current strategy config) into the
concrete resolvers. The editor stays ignorant of any specific strategy - the
owning plugin supplies the resolvers, mirroring the backend extension-point
pattern. Because the editor passes the strategy config down to the collector
forms, a collector-field resolver can read a selection made in the sibling
strategy form (the pattern picker lists the chosen stream's Drain patterns).

`logstream-frontend` contributes the `logstreamStreamId` and
`logstreamPatternId` resolvers, backed by the `typeScoped` `listStreamsForPicker`
and `listPatterns` procedures, and `logstream-common` now exports the shared
strategy id and resolver-name constants so the backend annotations and the
frontend resolvers reference one source and cannot drift.
