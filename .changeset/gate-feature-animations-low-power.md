---
"@checkstack/slo-frontend": patch
"@checkstack/auth-frontend": patch
---

Gate three feature-module animations behind the low-power performance tier so
they respect `.claude/rules/performance.md`. The SLO streak flame
(`StreakCounter`) and ongoing-downtime dot (`DowntimeTimeline`) no longer
`animate-pulse`, and the auth "Reload Authentication" refresh icon
(`StrategiesTab`) no longer `animate-spin`, when `usePerformance().isLowPower`
is true. The icons render statically in that case; high-power devices are
unchanged.
