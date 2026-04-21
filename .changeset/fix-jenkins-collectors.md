---
"@checkstack/healthcheck-backend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/healthcheck-jenkins-backend": patch
---

fix: remove arbitrary hardcoded assertions in jenkins collectors (queue-info, node-health, job-status) to prevent silent fallback assertion failures, instead properly threading transport execution errors directly to the SingleRunChartGrid UI display widget via a new `_collectorError` result payload property.
