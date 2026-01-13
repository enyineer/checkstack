# @checkstack/healthcheck-jenkins-backend

## 0.2.0

### Minor Changes

- 97c5a6b: Add Jenkins health check strategy with 5 collectors

  - **Jenkins Strategy**: Transport client for Jenkins REST API with Basic Auth (username + API token)
  - **Server Info Collector**: Jenkins version, mode, executor count, job count
  - **Job Status Collector**: Individual job monitoring, last build status, build duration
  - **Build History Collector**: Analyze recent builds for trends (success rate, avg duration)
  - **Queue Info Collector**: Monitor build queue length, wait times, stuck items
  - **Node Health Collector**: Agent availability, executor utilization

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
