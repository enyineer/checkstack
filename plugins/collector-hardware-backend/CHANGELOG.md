# @checkstack/collector-hardware-backend

## 0.1.1

### Patch Changes

- Updated dependencies [97c5a6b]
- Updated dependencies [8e43507]
- Updated dependencies [97c5a6b]
  - @checkstack/backend-api@0.2.0
  - @checkstack/common@0.1.0
  - @checkstack/healthcheck-common@0.2.0
  - @checkstack/healthcheck-ssh-common@0.1.1

## 0.1.0

### Minor Changes

- f5b1f49: Added CPU, Disk, and Memory hardware collectors for SSH-based system monitoring.

  - `CpuCollector`: Monitors CPU usage, load averages (1m, 5m, 15m), and core count
  - `DiskCollector`: Monitors disk usage for configurable mount points
  - `MemoryCollector`: Monitors RAM usage and optional swap metrics
  - All collectors work via SSH transport for remote system monitoring

### Patch Changes

- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
- Updated dependencies [f5b1f49]
  - @checkstack/backend-api@0.1.0
  - @checkstack/healthcheck-common@0.1.0
  - @checkstack/healthcheck-ssh-common@0.1.0
  - @checkstack/common@0.0.3
