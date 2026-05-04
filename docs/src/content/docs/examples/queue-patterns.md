---
title: "Queue Patterns"
---
## Pattern 2: Distributed Cache Sync (Broadcast)

Use broadcast pattern when all instances must process each message.

```typescript
// Unique consumer group per instance = broadcast
const queue = queueManager.getQueue<AccessRuleSyncData>('access-rule-sync');

await queue.consume(async (job) => {
  const { userId, roles } = job.data;
  await accessCache.refresh(userId, roles);
}, {
  consumerGroup: `access-rule-sync:${instanceId}`, // Unique!
  maxRetries: 3,
});

// Trigger sync (all instances receive)
await queue.enqueue({ userId: '123', roles: ['admin'] });
```

**Key points:**
- Unique `consumerGroup` per instance enables broadcast
- Every instance receives every message
- Use for cache invalidation, config updates

---

## Pattern 3: Background Jobs with Priority

Use priority for user-triggered tasks that should jump the queue.

```typescript
const queue = queueManager.getQueue<ExportJob>('exports');

await queue.consume(async (job) => {
  const { userId, systemIds, format } = job.data;
  const filePath = await generateExport(systemIds, format);
  await sendExportReady(userId, filePath);
}, {
  consumerGroup: 'exports',
  maxRetries: 3,
});

// User-triggered = high priority
await queue.enqueue(
  { userId, systemIds, format: 'csv' },
  { priority: 100 }
);

// Background task = low priority
await queue.enqueue(
  { userId: 'system', systemIds: allIds, format: 'csv' },
  { priority: 1 }
);
```

**Key points:**
- Higher priority number = processed first
- Combine with work-queue for load balancing

---

## Pattern 4: Delayed Execution

Schedule jobs to run after a delay.

```typescript
// Send reminder email in 24 hours
await queue.enqueue(
  { userId, type: 'reminder' },
  { startDelay: 86400 } // seconds
);

// Rate-limited retries
await queue.enqueue(data, { 
  startDelay: 60,  // Wait 1 minute
  priority: 5 
});
```

---

## Pattern 5: Job Deduplication

Prevent duplicate jobs using custom job IDs.

```typescript
// Only one sync per user at a time
await queue.enqueue(
  { userId: '123', data: newData },
  { jobId: `sync:user:123` }
);

// Second call returns existing job ID (no duplicate)
await queue.enqueue(
  { userId: '123', data: newerData },
  { jobId: `sync:user:123` }
);
```

---

## See Also

- [Queue System Overview](../backend/queue-system.md)
- [Implementing Custom Queue Plugins](../backend/queue-system.md#implementing-custom-queue-plugins)
