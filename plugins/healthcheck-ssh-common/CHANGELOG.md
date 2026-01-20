# @checkstack/healthcheck-ssh-common

## 0.1.6

### Patch Changes

- Updated dependencies [db1f56f]
  - @checkstack/common@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [8a87cd4]
  - @checkstack/common@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [83557c7]
  - @checkstack/common@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [7a23261]
  - @checkstack/common@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [9faec1f]
- Updated dependencies [f533141]
  - @checkstack/common@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [8e43507]
  - @checkstack/common@0.1.0

## 0.1.0

### Minor Changes

- f5b1f49: Refactored health check strategies to use `createClient()` pattern with built-in collectors.

  **Strategy Changes:**

  - Replaced `execute()` with `createClient()` that returns a transport client
  - Strategy configs now only contain connection parameters
  - Collector configs handle what to do with the connection

  **Built-in Collectors Added:**

  - DNS: `LookupCollector` for hostname resolution
  - gRPC: `HealthCollector` for gRPC health protocol
  - HTTP: `RequestCollector` for HTTP requests
  - MySQL: `QueryCollector` for database queries
  - Ping: `PingCollector` for ICMP ping
  - Postgres: `QueryCollector` for database queries
  - Redis: `CommandCollector` for Redis commands
  - Script: `ExecuteCollector` for script execution
  - SSH: `CommandCollector` for SSH commands
  - TCP: `BannerCollector` for TCP banner grabbing
  - TLS: `CertificateCollector` for certificate inspection

### Patch Changes

- Updated dependencies [f5b1f49]
  - @checkstack/common@0.0.3
