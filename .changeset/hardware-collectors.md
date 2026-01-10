---
"@checkstack/collector-hardware-backend": minor
---

Added CPU, Disk, and Memory hardware collectors for SSH-based system monitoring.

- `CpuCollector`: Monitors CPU usage, load averages (1m, 5m, 15m), and core count
- `DiskCollector`: Monitors disk usage for configurable mount points
- `MemoryCollector`: Monitors RAM usage and optional swap metrics
- All collectors work via SSH transport for remote system monitoring
