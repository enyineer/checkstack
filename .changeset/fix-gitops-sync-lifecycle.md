---
"@checkstack/gitops-backend": patch
---

### GitOps: Fix sync lifecycle management

- Schedule recurring sync job immediately when creating a provider (previously required server restart)
- Reschedule recurring job when provider's sync interval is updated
- Cancel recurring job when provider is deleted
- Fix manual sync trigger being silently dropped due to job ID deduplication
