---
---
# Queue System

The Checkmate Queue system provides a pluggable, type-safe infrastructure for managing asynchronous tasks and distributed events. It is designed to scale from simple in-memory development environments to multi-node production clusters.

## Table of Contents

- [Overview and Concepts](#overview-and-concepts)
- [Architecture](#architecture)
- [How It Works Internally](#how-it-works-internally)
- [Behavior and Guarantees](#behavior-and-guarantees)
- [Implementing Custom Queue Plugins](#implementing-custom-queue-plugins)
- [Practical Examples](#practical-examples)

---

## Overview and Concepts

### What is the Queue System?

The Queue system is Checkmate's abstraction for asynchronous task processing. It provides:

- **Reliable job execution** with automatic retries and exponential backoff
- **Flexible message routing** via consumer groups (work queue or broadcast patterns)
- **Priority-based processing** to handle urgent tasks first
- **Delayed job execution** for scheduled or periodic tasks
- **Pluggable backends** allowing you to swap between in-memory, Redis, or custom implementations

### Core Concepts

#### Jobs

A **job** represents a unit of work to be processed asynchronously. Each job contains:

```typescript
interface QueueJob<T = unknown> {
  id: string;              // Unique identifier
  data: T;                 // The payload to process
  priority?: number;       // Higher values = processed first (default: 0)
  timestamp: Date;         // When the job was enqueued
  attempts?: number;       // Current retry count
}
```

#### Queues

A **queue** is a named channel for jobs of a specific type. Queues handle:

- **Enqueuing** jobs with optional priority, delay, or deduplication
- **Consuming** jobs via registered handlers
- **Routing** jobs to consumer groups
- **Statistics** for monitoring pending, processing, completed, and failed jobs

#### Consumer Groups

**Consumer groups** determine how messages are distributed across multiple instances:

- **Work Queue Pattern** (Competing Consumers): Multiple consumers share the same `consumerGroup` ID. Each message is delivered to only one consumer in the group (load balancing).
- **Broadcast Pattern** (Fan-out): Each consumer uses a unique `consumerGroup` ID (e.g., suffixed with instance ID). Every consumer receives a copy of every message.

#### Priorities

Jobs can be assigned a numeric priority (higher = more urgent). The queue processes higher-priority jobs before lower-priority ones, regardless of enqueue order.

### When to Use the Queue System

Use the Queue system when you need:

- **Asynchronous processing** that shouldn't block HTTP responses
- **Distributed coordination** for tasks that should run on only one instance
- **Broadcast notifications** that every instance must handle
- **Periodic or scheduled tasks** with resilience to restarts
- **Retry logic** for unreliable operations (API calls, network requests)

---

## Architecture

The Queue system is built on a **factory pattern** that allows different backends to be used transparently.

### Core Components

#### QueuePlugin

The `QueuePlugin` interface defines how to create queue instances:

```typescript
interface QueuePlugin<Config = unknown> {
  id: string;                      // Unique plugin identifier (e.g., "memory", "redis")
  displayName: string;             // Human-readable name
  description?: string;            // Optional description
  
  configVersion: number;           // Current config schema version
  configSchema: z.ZodType<Config>; // Zod schema for validation
  migrations?: MigrationChain<Config>; // Optional version migrations
  
  createQueue<T>(name: string, config: Config): Queue<T>;
}
```

All queue plugins must implement this interface to be compatible with the system.

#### QueuePluginRegistry

A central registry where queue plugins are registered at startup:

```typescript
interface QueuePluginRegistry {
  register(plugin: QueuePlugin<unknown>): void;
  getPlugin(id: string): QueuePlugin<unknown> | undefined;
  getPlugins(): QueuePlugin<unknown>[];
}
```

Plugins are typically registered in their backend plugin's `register` lifecycle hook.

#### QueueManager

The `QueueManager` service is responsible for managing queue instances and backend switching:

```typescript
interface QueueManager {
  // Get or create a queue proxy (synchronous, returns stable reference)
  getQueue<T>(name: string): Queue<T>;
  
  // Active backend management
  getActivePlugin(): string;
  setActiveBackend(pluginId: string, config: unknown): Promise<void>;
  
  // Multi-instance coordination  
  startPolling(intervalMs?: number): void;
  stopPolling(): void;
  
  // Monitoring and status
  getInFlightJobCount(): Promise<number>;
  listAllRecurringJobs(): Promise<RecurringJobDetails[]>;
  
  // Graceful shutdown
  shutdown(): Promise<void>;
}
```

Applications use `QueueManager.getQueue()` to obtain queue references without knowing which backend is active. The returned queue is actually a `QueueProxy` that provides stable references across backend switches.

#### QueueProxy

The `QueueProxy` class wraps actual queue implementations to provide:

- **Stable references**: The same proxy can survive backend switches
- **Subscription replay**: When switching backends, all subscriptions are automatically re-applied
- **Pending operation tracking**: Waits for in-flight operations before switching

```typescript
class QueueProxy<T> implements Queue<T> {
  // All Queue methods delegate to the underlying implementation
  // On backend switch, subscriptions are automatically replayed
  async switchDelegate(newQueue: Queue<T>): Promise<void>;
}
```

#### Queue Interface

The `Queue` interface is the primary interaction point:

```typescript
interface Queue<T = unknown> {
  enqueue(
    data: T,
    options?: {
      priority?: number;
      startDelay?: number;  // Delay before job becomes available (renamed from delaySeconds)
      jobId?: string;       // For deduplication
    }
  ): Promise<string>;

  consume(
    consumer: QueueConsumer<T>,
    options: ConsumeOptions
  ): Promise<void>;

  // Recurring job management (native support)
  scheduleRecurring(
    jobId: string,
    data: T,
    intervalSeconds: number,
    options?: { startDelay?: number }
  ): Promise<void>;
  cancelRecurring(jobId: string): Promise<void>;
  listRecurringJobs(): Promise<string[]>;
  getRecurringJobDetails(jobId: string): Promise<RecurringJobDetails | undefined>;
  
  // Monitoring
  getInFlightCount(): Promise<number>;
  stop(): Promise<void>;
  getStats(): Promise<QueueStats>;
  testConnection(): Promise<void>;
}
```

---

## How It Works Internally

### Job Lifecycle

1. **Enqueue**: A job is added to the queue with optional priority, delay, or custom ID
2. **Routing**: The queue determines which consumer groups should receive the job
3. **Selection**: Within each consumer group, a consumer is selected (round-robin)
4. **Processing**: The consumer's handler function is invoked with the job
5. **Completion**: On success, the job is marked complete; on failure, it may be retried
6. **Cleanup**: Once all consumer groups have processed the job, it's removed from the queue

### Consumer Group Routing Logic

The queue maintains state for each consumer group:

```typescript
interface ConsumerGroupState<T> {
  consumers: Array<{
    id: string;
    handler: QueueConsumer<T>;
    maxRetries: number;
  }>;
  nextConsumerIndex: number;      // For round-robin selection
  processedJobIds: Set<string>;   // Track which jobs this group has seen
}
```

**Routing Rules:**

- A job is eligible for a consumer group if that group has NOT processed it yet
- Within a group, consumers are selected in round-robin order
- A job is removed from the queue only when ALL registered groups have processed it
- Failed jobs are re-added to the queue for retry (with exponential backoff)

### Priority Handling

Jobs are stored in priority order (higher priority first). When multiple jobs are pending:

1. The queue scans for the highest-priority job that hasn't been processed by a given consumer group
2. Jobs with the same priority are processed in FIFO order
3. Enqueuing a job triggers re-insertion at the correct position based on priority

### Delayed Job Execution

Jobs can be enqueued with a `startDelay` option (in seconds):

```typescript
await queue.enqueue(data, { startDelay: 60 }); // Available in 60 seconds
```

**Implementation:**

- Each job has an `availableAt` timestamp (current time + delay)
- The queue skips jobs where `availableAt > now` during selection
- Efficient implementations use timers to trigger processing when jobs become available

### Retry Mechanism with Exponential Backoff

When a consumer throws an error:

1. The job's `attempts` counter is incremented
2. If `attempts < maxRetries`, the job is re-queued
3. A delay is calculated: `2^attempts * 1000ms` (exponential backoff)
4. After the delay, the job becomes available for the same consumer group again
5. If `attempts >= maxRetries`, the job is marked as failed

**Example backoff sequence:**
- Attempt 1 fails → retry after 2 seconds
- Attempt 2 fails → retry after 4 seconds
- Attempt 3 fails → retry after 8 seconds
- Attempt 4 fails → mark as failed

### Job Deduplication via jobId

When enqueuing with a custom `jobId`:

```typescript
await queue.enqueue(data, { jobId: 'healthcheck:system-123' });
```

**Behavior:**

- If a job with this ID already exists, the enqueue is **ignored** (returns existing ID)
- This prevents duplicate jobs from being created in distributed scenarios
- Useful for periodic tasks or idempotent operations

### Concurrency Control

Queue implementations typically use a **semaphore** to limit concurrent job processing:

```typescript
const semaphore = new Semaphore(config.concurrency); // e.g., 10

async function processJob(job) {
  await semaphore.acquire();
  try {
    await handler(job);
  } finally {
    semaphore.release();
  }
}
```

This prevents resource exhaustion and allows fine-tuning of throughput.

---

## Behavior and Guarantees

### Delivery Semantics

The Queue system provides **at-least-once delivery**:

- Jobs are guaranteed to be delivered to each consumer group at least once
- In failure scenarios (e.g., crashes), jobs may be delivered more than once
- Consumer handlers should be **idempotent** to handle duplicate processing safely

### Message Ordering

- **Within a priority level**, jobs are processed in FIFO order
- **Across priority levels**, higher-priority jobs always come first
- **No strict ordering guarantee** for jobs processed by different consumer groups concurrently

### Consumer Group Isolation

- Each consumer group maintains independent processing state
- A failure in one consumer group does NOT affect other groups
- Groups can have different `maxRetries` settings

### Graceful Shutdown

`queue.stop()` behavior:

1. Marks the queue as stopped (no new jobs are processed)
2. Waits for all currently processing jobs to complete
3. Returns once all in-flight work is finished

This ensures data consistency during application shutdown.

### Statistics and Monitoring

`queue.getStats()` returns:

```typescript
interface QueueStats {
  pending: number;       // Jobs waiting to be processed
  processing: number;    // Jobs currently being handled
  completed: number;     // Total successful jobs (lifetime)
  failed: number;        // Total failed jobs after all retries (lifetime)
  consumerGroups: number; // Number of active consumer groups
}
```

Use these metrics for monitoring, alerting, and capacity planning.

### Configuration Versioning and Migrations

Queue plugins support versioned configurations with automatic migrations:

- **configVersion**: The current schema version
- **migrations**: Array of migration functions to upgrade old configs

When loading a config, the system:

1. Checks the stored `configVersion`
2. Applies necessary migrations in sequence
3. Validates the final config against `configSchema`

This ensures backward compatibility when queue configuration evolves.

---

## Implementing Custom Queue Plugins

This section guides you through creating a custom queue plugin, such as a Redis-based backend.

### Step 1: Define Your Configuration Schema

Use Zod to define the plugin's configuration:

```typescript
import { z } from 'zod';

const redisConfigSchema = z.object({
  host: z.string().default('localhost').describe('Redis server hostname'),
  port: z.number().min(1).max(65535).default(6379).describe('Redis server port'),
  password: z.string().optional().describe('Redis password (if required)'),
  db: z.number().min(0).default(0).describe('Redis database number'),
  maxRetries: z.number().min(0).default(3).describe('Default max retries for jobs'),
});

export type RedisQueueConfig = z.infer<typeof redisConfigSchema>;
```

### Step 2: Implement the Queue Interface

Create a class that implements the `Queue<T>` interface:

```typescript
import { Queue, QueueJob, QueueConsumer, ConsumeOptions, QueueStats } from '@checkmate/queue-api';

export class RedisQueue<T> implements Queue<T> {
  private redis: Redis;
  private stopped = false;

  constructor(private name: string, private config: RedisQueueConfig) {
    // Initialize Redis connection
    this.redis = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
    });
  }

  async enqueue(
    data: T,
    options?: { priority?: number; delaySeconds?: number; jobId?: string }
  ): Promise<string> {
    const jobId = options?.jobId ?? crypto.randomUUID();
    const job: QueueJob<T> = {
      id: jobId,
      data,
      priority: options?.priority ?? 0,
      timestamp: new Date(),
      attempts: 0,
    };

    // Check for duplicates
    if (options?.jobId) {
      const exists = await this.redis.exists(`job:${this.name}:${jobId}`);
      if (exists) return jobId;
    }

    // Store job data
    await this.redis.set(`job:${this.name}:${jobId}`, JSON.stringify(job));

    // Add to priority queue
    const score = options?.priority ?? 0;
    const member = jobId;
    
    if (options?.delaySeconds) {
      const availableAt = Date.now() + options.delaySeconds * 1000;
      await this.redis.zadd(`delayed:${this.name}`, availableAt, member);
    } else {
      await this.redis.zadd(`queue:${this.name}`, -score, member); // Negative for descending
    }

    return jobId;
  }

  async consume(consumer: QueueConsumer<T>, options: ConsumeOptions): Promise<void> {
    // Register consumer and start polling loop
    // Implementation details omitted for brevity
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.redis.quit();
  }

  async getStats(): Promise<QueueStats> {
    const pending = await this.redis.zcard(`queue:${this.name}`);
    const delayed = await this.redis.zcard(`delayed:${this.name}`);
    // Implementation details omitted
    return { pending: pending + delayed, processing: 0, completed: 0, failed: 0, consumerGroups: 0 };
  }
}
```

### Step 3: Implement the QueuePlugin Interface

Create the plugin class:

```typescript
import { QueuePlugin } from '@checkmate/queue-api';

export class RedisQueuePlugin implements QueuePlugin<RedisQueueConfig> {
  id = 'redis';
  displayName = 'Redis Queue';
  description = 'Production-ready queue backed by Redis';
  configVersion = 1;
  configSchema = redisConfigSchema;

  createQueue<T>(name: string, config: RedisQueueConfig): Queue<T> {
    return new RedisQueue<T>(name, config);
  }
}
```

### Step 4: Register the Plugin

In your backend plugin's `register` lifecycle:

```typescript
import { createBackendPlugin, coreServices } from '@checkmate/backend-api';
import { RedisQueuePlugin } from './redis-queue-plugin';
import { pluginMetadata } from './plugin-metadata';

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        queueRegistry: coreServices.queuePluginRegistry,
      },
      init: async ({ logger, queueRegistry }) => {
        logger.debug('🔌 Registering Redis Queue Plugin...');
        queueRegistry.register(new RedisQueuePlugin());
      },
    });
  },
});
```

### Step 5: Consumer Group Support

To support consumer groups properly:

- **Track group state** (which jobs each group has processed)
- **Implement round-robin selection** within each group
- **Ensure broadcast semantics** (each group gets a copy of each job)
- **Handle per-group retries** independently

In Redis, you might use:
- `SET` for each group's processed job IDs: `processed:{queue}:{group}`
- `LIST` for consumers in each group: `consumers:{queue}:{group}`
- `HASH` for consumer metadata (max retries, etc.)

### Step 6: Testing Your Plugin

Create comprehensive tests covering:

- **Basic enqueue/consume flow**
- **Priority ordering**
- **Delayed job execution**
- **Job deduplication via jobId**
- **Consumer group isolation** (work queue vs broadcast)
- **Retry logic and exponential backoff**
- **Graceful shutdown**
- **Statistics accuracy**

Example test structure:

```typescript
import { describe, test, expect } from 'bun:test';
import { RedisQueue } from './redis-queue';

describe('RedisQueue', () => {
  test('should process jobs in priority order', async () => {
    const queue = new RedisQueue('test', defaultConfig);
    const processed: number[] = [];

    await queue.consume(async (job) => {
      processed.push(job.data as number);
    }, { consumerGroup: 'test-group' });

    await queue.enqueue(1, { priority: 5 });
    await queue.enqueue(2, { priority: 10 });
    await queue.enqueue(3, { priority: 1 });

    await sleep(100);
    expect(processed).toEqual([2, 1, 3]); // Highest priority first
  });

  // More tests...
});
```

---

## Practical Examples

### Example 1: InMemoryQueue Reference Implementation

The `InMemoryQueue` is a complete, production-ready implementation suitable for single-instance deployments. Let's examine key implementation details:

#### Configuration

```typescript
const configSchema = z.object({
  concurrency: z
    .number()
    .min(1)
    .max(100)
    .default(10)
    .describe('Maximum number of concurrent jobs to process'),
  maxQueueSize: z
    .number()
    .min(1)
    .default(10_000)
    .describe('Maximum number of jobs that can be queued'),
  delayMultiplier: z
    .number()
    .min(0)
    .max(1)
    .default(1)
    .describe('Delay multiplier (default: 1). Only change for testing purposes - set to 0.01 for 100x faster test execution.'),
});
```

#### Testing Configuration: delayMultiplier

The `delayMultiplier` configuration option allows tests to run significantly faster by reducing all time-based delays:

**Purpose:**
- In production, `delayMultiplier` defaults to `1` (normal delays)
- In tests, set to `0.01` for 100x faster execution (2s delay → 20ms)

**Affected delays:**
- `startDelay` in `enqueue()` - Jobs become available sooner
- Exponential backoff in retry logic - Retries happen faster
- `intervalSeconds` in recurring jobs - Jobs repeat more quickly

**Implementation guidance for queue plugins:**

1. **Add to config schema** (optional but recommended for development/test backends):
   ```typescript
   delayMultiplier: z.number().min(0).max(1).default(1)
     .describe('Delay multiplier (default: 1). Only change for testing purposes.')
   ```

2. **Apply to all delay calculations:**
   ```typescript
   // In enqueue()
   const delayMs = options.startDelay * 1000 * (this.config.delayMultiplier ?? 1);
   
   // In retry logic
   const retryDelay = Math.pow(2, job.attempts) * 1000 * (this.config.delayMultiplier ?? 1);
   ```

3. **Update tests to use faster delays:**
   ```typescript
   const queue = new InMemoryQueue('test-queue', {
     concurrency: 10,
     maxQueueSize: 100,
     delayMultiplier: 0.01, // 100x faster for testing
   });
   
   // Wait 50ms instead of 5s
   await new Promise(r => setTimeout(r, 50));
   ```

> **Note:** Production queue backends like BullMQ may not need `delayMultiplier` since delays are typically handled by the external system (Redis). The option is most useful for in-process queue implementations used in development and testing.


#### Consumer Group State Tracking

```typescript
interface ConsumerGroupState<T> {
  consumers: Array<{
    id: string;
    handler: QueueConsumer<T>;
    maxRetries: number;
  }>;
  nextConsumerIndex: number;      // For round-robin
  processedJobIds: Set<string>;   // Track processed jobs per group
}

private consumerGroups = new Map<string, ConsumerGroupState<T>>();
```

#### Job Selection Logic

```typescript
private async processNext(): Promise<void> {
  const now = new Date();

  // For each consumer group, find an unprocessed job
  for (const [groupId, groupState] of this.consumerGroups.entries()) {
    // Find next unprocessed job that is available (not delayed)
    const job = this.jobs.find(
      (j) => !groupState.processedJobIds.has(j.id) && j.availableAt <= now
    );

    if (!job) continue;

    // Mark as processed by this group
    groupState.processedJobIds.add(job.id);

    // Select consumer via round-robin
    const consumerIndex = groupState.nextConsumerIndex % groupState.consumers.length;
    const selectedConsumer = groupState.consumers[consumerIndex];
    groupState.nextConsumerIndex++;

    // Process asynchronously
    void this.processJob(job, selectedConsumer, groupId, groupState);
  }

  // Remove fully processed jobs (all groups have seen them)
  this.jobs = this.jobs.filter((job) => {
    return ![...this.consumerGroups.values()].every((group) =>
      group.processedJobIds.has(job.id)
    );
  });
}
```

#### Retry with Exponential Backoff

```typescript
private async processJob(job, consumer, groupId, groupState): Promise<void> {
  await this.semaphore.acquire();
  this.processing++;

  let isRetrying = false;

  try {
    await consumer.handler(job);
    this.stats.completed++;
  } catch (error) {
    if (job.attempts < consumer.maxRetries) {
      job.attempts++;
      isRetrying = true;

      // Remove from processed set to allow retry
      groupState.processedJobIds.delete(job.id);

      // Re-add to queue
      this.jobs.splice(insertIndex, 0, job);

      // Schedule retry with exponential backoff
      const delay = Math.pow(2, job.attempts) * 1000;
      setTimeout(() => {
        if (!this.stopped) void this.processNext();
      }, delay);
    } else {
      this.stats.failed++;
    }
  } finally {
    this.processing--;
    this.semaphore.release();

    // Continue processing (unless this is a retry)
    if (!isRetrying && !this.stopped) {
      void this.processNext();
    }
  }
}
```

**Key Takeaways:**
- Semaphore controls concurrency
- Consumer groups maintain independent processed job sets
- Failed jobs are removed from the processed set and re-added to the queue
- Exponential backoff prevents retry storms

### Example 2: Redis-Based Queue Plugin (Conceptual)

For distributed deployments, a Redis-based plugin provides:

- **Persistence**: Jobs survive instance restarts
- **Shared state**: All instances see the same queue
- **Atomic operations**: Redis commands ensure consistency

**Conceptual structure:**

```typescript
class RedisQueue<T> implements Queue<T> {
  // Redis keys:
  // - job:{queue}:{jobId} → Job data (hash)
  // - queue:{queue}:pending → Sorted set (score = -priority)
  // - queue:{queue}:delayed → Sorted set (score = availableAt timestamp)
  // - queue:{queue}:processing:{group} → Set of job IDs currently processing
  // - queue:{queue}:processed:{group} → Set of job IDs processed by group
  // - queue:{queue}:consumers:{group} → List of consumer IDs

  async enqueue(data, options) {
    // 1. Check for duplicate jobId
    // 2. Store job data as hash
    // 3. Add to pending or delayed sorted set
    // 4. Publish notification to consumers
  }

  async consume(consumer, options) {
    // 1. Register consumer in group list
    // 2. Start polling loop with BLPOP or Pub/Sub
    // 3. Claim job atomically using Lua script
    // 4. Process and update state
  }

  // Use Lua scripts for atomic operations (claim, retry, complete)
}
```

**Advantages:**
- Multi-instance coordination out of the box
- No single point of failure (with Redis clustering)
- Rich ecosystem (monitoring tools, dashboards)

### Example 3: Common Usage Patterns

#### Pattern 1: Periodic Health Checks (Using Native Recurring Jobs)

```typescript
// In healthcheck-backend plugin
async function scheduleHealthCheck(queueManager: QueueManager, configId: string, systemId: string, intervalSeconds: number) {
  const queue = queueManager.getQueue<HealthCheckData>('health-checks');
  
  // Use deterministic job ID for deduplication
  const jobId = `healthcheck:${configId}:${systemId}`;
  
  // Schedule as recurring job - the queue handles rescheduling automatically
  await queue.scheduleRecurring(
    jobId,
    { configId, systemId },
    intervalSeconds,
    { startDelay: 0 } // Run immediately the first time
  );
}

// Consumer (work-queue mode - only one instance runs each check)
const queue = queueManager.getQueue<HealthCheckData>('health-checks');
await queue.consume(async (job) => {
  const { configId, systemId } = job.data;
  
  // Execute health check
  const result = await runHealthCheck(configId, systemId);
  
  // Store result
  await saveHealthCheckResult(systemId, result);
  
  // No need to manually reschedule - scheduleRecurring handles this!
}, {
  consumerGroup: 'health-checks',  // Shared group = work queue
  maxRetries: 0,                    // Don't retry (next interval will run anyway)
});
```

#### Pattern 2: Distributed Permission Sync

```typescript
// Broadcast pattern - all instances must sync
const queue = queueManager.getQueue<PermissionSyncData>('permission-sync');

await queue.consume(async (job) => {
  const { userId, roles } = job.data;
  
  // Update local permission cache
  await permissionCache.refresh(userId, roles);
}, {
  consumerGroup: `permission-sync:${instanceId}`, // Unique per instance = broadcast
  maxRetries: 3,
});

// Trigger sync from one instance
await queue.enqueue({ userId: '123', roles: ['admin', 'editor'] });
// All instances receive and process this
```

#### Pattern 3: Background Data Export

```typescript
// High-priority work queue for user-triggered exports
const queue = queueManager.getQueue<ExportJob>('exports');

await queue.consume(async (job) => {
  const { userId, systemIds, format } = job.data;
  
  // Generate export file
  const filePath = await generateExport(systemIds, format);
  
  // Notify user
  await sendExportReady(userId, filePath);
}, {
  consumerGroup: 'exports',  // Work queue - any instance can handle
  maxRetries: 3,
});

// User triggers export (high priority)
await queue.enqueue(
  { userId, systemIds, format: 'csv' },
  { priority: 100 } // Higher than routine tasks
);
```

---

## Summary

The Checkmate Queue system provides a powerful, flexible foundation for asynchronous task processing:

- **Pluggable architecture** allows swapping backends without code changes
- **Consumer groups** enable both work-queue and broadcast patterns
- **Built-in reliability** with retries, exponential backoff, and graceful shutdown
- **Priority and delayed execution** for fine-grained control
- **Job deduplication** prevents duplicate work in distributed environments

By implementing the `QueuePlugin` interface, you can integrate any backend (Redis, RabbitMQ, AWS SQS, etc.) while maintaining a consistent API for the rest of your application.

For reference implementations, see:
- [`InMemoryQueue`](/plugins/queue-memory-backend/src/memory-queue.ts) - Complete working example
- [`Queue API`](/core/queue-api/src/queue.ts) - Core interfaces
- [`QueuePlugin Interface`](/core/queue-api/src/queue-plugin.ts) - Plugin contract
