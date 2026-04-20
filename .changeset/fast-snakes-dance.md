---
"@checkstack/ui": patch
"@checkstack/frontend": patch
"@checkstack/command-frontend": patch
"@checkstack/dashboard-frontend": patch
---

Implemented a global performance-aware UI infrastructure that detects hardware capabilities (using heuristics and frame-budget benchmarks) to automatically disable expensive CSS animations, backdrop-blurs, and glassmorphism effects on low-power or non-hardware-accelerated devices.
