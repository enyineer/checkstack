# @checkstack/k8s-events-backend

## 0.1.4

### Patch Changes

- @checkstack/telemetry-backend@0.2.2

## 0.1.3

### Patch Changes

- @checkstack/telemetry-common@0.2.1
- @checkstack/backend-api@0.35.1
- @checkstack/k8s-events-common@0.1.3
- @checkstack/telemetry-backend@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/backend-api@0.35.0
  - @checkstack/telemetry-common@0.2.0
  - @checkstack/telemetry-backend@0.2.0
  - @checkstack/k8s-events-common@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [be74b01]
  - @checkstack/k8s-events-common@0.1.1
  - @checkstack/telemetry-backend@0.1.1
  - @checkstack/backend-api@0.34.1
  - @checkstack/telemetry-common@0.1.1

## 0.1.0

### Minor Changes

- 6c8b36b: New Kubernetes events source (`k8s-events.k8s-events`): an interval-pull
  source that lists cluster events from the modern `events.k8s.io/v1` API
  (request shapes verified against the official Kubernetes API reference)
  and ingests them as log records - Warning events as warnings, with the
  event's reason/note as the body and the regarding-object identity,
  reporting controller, and a stable `k8s.event.uid` in the attributes.
  Auth is a service-account bearer token (encrypted at rest, resolved
  just-in-time on satellites); namespace, fieldSelector and labelSelector
  scope the pull. Time-window pulls overlap slightly by design
  (`lookbackSeconds`), so rare duplicates are possible and documented -
  the stable event identity enables future dedupe. Supports satellite
  execution via a statically-linked pull executor.

  `maxEventsPerPull` caps EMITTED in-window records (the list API returns
  events roughly oldest-first, so the scan pages past out-of-window
  backlog to reach recent events); the scan itself is bounded by a
  40-page budget, and a busy cluster that exhausts it yields a partial
  window with an operator warning (core and satellite) recommending a
  namespace or fieldSelector, while a server that pages forever without
  items fails as a transport error.

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/telemetry-backend@0.1.0
  - @checkstack/backend-api@0.34.0
  - @checkstack/k8s-events-common@0.1.0
  - @checkstack/common@0.23.0
