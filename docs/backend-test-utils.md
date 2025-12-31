# Backend Test Utilities

Checkmate provides a comprehensive set of testing utilities specifically designed for backend packages. These utilities enable fast, deterministic unit tests by providing sophisticated mocks for core services like databases, loggers, queues, and RPC contexts.

## Table of Contents

- [Overview](#overview)
- [Installation and Setup](#installation-and-setup)
- [Core Utilities Reference](#core-utilities-reference)
- [Common Usage Patterns](#common-usage-patterns)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

### Philosophy: Side-Effect-Free Testing

The test utilities in Checkmate follow a critical principle: **prevent side-effect poisoning** during test execution.

**Side-effect poisoning** occurs when importing a module triggers production code that requires a full production environment (e.g., database connections, environment variable validation, service initialization). This makes tests fragile, slow, and environment-dependent.

To prevent this, Checkmate externalizes all testing utilities into dedicated packages:

- **`@checkmate/test-utils-backend`**: Core mocks for backend services (DB, Logger, Fetch, Queues)
- **`@checkmate/backend-api/test-utils`**: Mocks for API-level structures (RpcContext)

> **CRITICAL**: Never import from main entry points like `@checkmate/backend` in unit tests. Always use the dedicated test utility packages.

### Why Use These Utilities?

- **Consistent behavior**: Standardized mocks across the entire codebase
- **Chainable interfaces**: Mocks support the same fluent API as production services
- **Zero configuration**: Works out of the box with sensible defaults
- **Type-safe**: Full TypeScript support with proper type inference
- **Maintained centrally**: Updates propagate to all tests automatically

---

## Installation and Setup

### Adding to Your Package

Add the test utilities to your `devDependencies`:

```json
{
  "devDependencies": {
    "@checkmate/test-utils-backend": "workspace:*",
    "@checkmate/backend-api": "workspace:*"
  }
}
```

### Import Patterns

```typescript
// Import core mocking utilities
import {
  createMockDb,
  createMockLogger,
  createMockFetch,
  createMockQueueManager,
} from "@checkmate/test-utils-backend";

// Import RPC context mocking
import { createMockRpcContext } from "@checkmate/backend-api/test-utils";
```

### Basic Test Structure

```typescript
import { describe, test, expect, mock } from "bun:test";
import { createMockDb, createMockLogger } from "@checkmate/test-utils-backend";
import { MyService } from "./my-service";

describe("MyService", () => {
  test("should process data correctly", async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const service = new MyService(mockDb, mockLogger);

    await service.processData({ foo: "bar" });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Processing data...");
  });
});
```

---

## Core Utilities Reference

### createMockDb

Creates a mock Drizzle database instance with support for the most common query patterns.

**Source**: [`packages/test-utils-backend/src/mock-db.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-db.ts)

#### Supported Query Patterns

The mock supports chainable Drizzle queries:

```typescript
import { createMockDb } from "@checkmate/test-utils-backend";

const mockDb = createMockDb();

// SELECT queries
await mockDb.select().from(usersTable);
await mockDb.select().from(usersTable).where(eq(usersTable.id, "123"));
await mockDb.select().from(usersTable).where(eq(usersTable.id, "123")).limit(10);
await mockDb.select().from(usersTable).innerJoin(rolesTable).where(condition);
await mockDb.select().from(usersTable).where(condition).orderBy(usersTable.name).limit(5);

// INSERT queries
await mockDb.insert(usersTable).values({ name: "Alice" });
await mockDb.insert(usersTable).values({ name: "Bob" }).onConflictDoUpdate({ ... });
await mockDb.insert(usersTable).values({ name: "Charlie" }).returning();

// UPDATE queries
await mockDb.update(usersTable).set({ name: "Updated" }).where(eq(usersTable.id, "123"));
await mockDb.update(usersTable).set({ name: "Updated" }).returning();

// DELETE queries
await mockDb.delete(usersTable).where(eq(usersTable.id, "123"));
```

#### Basic Usage

```typescript
import { createMockDb } from "@checkmate/test-utils-backend";

test("should fetch user from database", async () => {
  const mockDb = createMockDb();
  const service = new UserService(mockDb);

  await service.getUserById("user-1");

  expect(mockDb.select).toHaveBeenCalled();
});
```

#### Customizing Return Values

For complex queries, you can override the mock to return specific data:

```typescript
import { createMockDb } from "@checkmate/test-utils-backend";

test("should return specific user data", async () => {
  const mockDb = createMockDb();
  const mockUserData = [{ id: "user-1", name: "Alice", role: "admin" }];

  // Override the select chain to return mock data
  (mockDb.select as any) = mock(() => ({
    from: mock(() => ({
      innerJoin: mock(() => ({
        where: mock(() => Promise.resolve(mockUserData)),
      })),
    })),
  }));

  const service = new UserService(mockDb);
  const result = await service.getUserWithRole("user-1");

  expect(result).toEqual(mockUserData);
});
```

#### Module Mocking

For tests that import the database module directly, use `createMockDbModule`:

```typescript
import { mock } from "bun:test";
import { createMockDbModule } from "@checkmate/test-utils-backend";

// Mock the entire database module
mock.module("./db", () => createMockDbModule());

// Now imports from './db' will use the mock
import { db } from "./db"; // This is mocked
```

---

### createMockLogger

Creates a mock logger instance with support for all standard logging levels and child logger creation.

**Source**: [`packages/test-utils-backend/src/mock-logger.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-logger.ts)

#### Basic Usage

```typescript
import { createMockLogger } from "@checkmate/test-utils-backend";

test("should log service initialization", async () => {
  const mockLogger = createMockLogger();
  const service = new MyService(mockLogger);

  await service.initialize();

  expect(mockLogger.info).toHaveBeenCalledWith("Service initialized");
});
```

#### Child Logger Support

The mock logger's `child()` method returns another mock logger:

```typescript
test("should use child logger for component", () => {
  const mockLogger = createMockLogger();
  const service = new MyService(mockLogger);

  service.processWithComponent("data-processor");

  expect(mockLogger.child).toHaveBeenCalledWith({ component: "data-processor" });
});
```

#### Available Methods

All standard logging levels are supported:

```typescript
const logger = createMockLogger();

logger.info("Information message");
logger.debug("Debug message");
logger.warn("Warning message");
logger.error("Error message");
const childLogger = logger.child({ context: "my-component" });
```

#### Module Mocking

```typescript
import { mock } from "bun:test";
import { createMockLoggerModule } from "@checkmate/test-utils-backend";

mock.module("./logger", () => createMockLoggerModule());

import { rootLogger } from "./logger"; // This is mocked
```

---

### createMockFetch

Creates a mock Fetch service for testing HTTP requests and inter-plugin communication.

**Source**: [`packages/test-utils-backend/src/mock-fetch.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-fetch.ts)

#### Basic Usage

```typescript
import { createMockFetch } from "@checkmate/test-utils-backend";

test("should make HTTP request", async () => {
  const mockFetch = createMockFetch();
  const service = new ExternalApiService(mockFetch);

  await service.fetchData();

  expect(mockFetch.fetch).toHaveBeenCalled();
});
```

#### Plugin-Scoped Requests

The `forPlugin()` method provides shortcuts for common HTTP methods:

```typescript
test("should call catalog plugin API", async () => {
  const mockFetch = createMockFetch();
  const service = new IntegrationService(mockFetch);

  await service.getCatalogEntities();

  expect(mockFetch.forPlugin).toHaveBeenCalledWith("catalog-backend");
});
```

#### Available Methods

```typescript
const fetch = createMockFetch();

// Generic fetch
await fetch.fetch("https://example.com");

// Plugin-scoped requests
const catalogApi = fetch.forPlugin("catalog-backend");
await catalogApi.get("/entities");
await catalogApi.post("/entities", { body: data });
await catalogApi.put("/entities/123", { body: data });
await catalogApi.patch("/entities/123", { body: data });
await catalogApi.delete("/entities/123");
```

#### Customizing Responses

```typescript
test("should handle API response", async () => {
  const mockFetch = createMockFetch();
  const mockData = { entities: [{ id: "1", name: "Service A" }] };

  // Override to return specific data
  (mockFetch.forPlugin as any) = mock(() => ({
    get: mock(() => 
      Promise.resolve({ 
        ok: true, 
        json: () => Promise.resolve(mockData) 
      })
    ),
  }));

  const service = new IntegrationService(mockFetch);
  const result = await service.getCatalogEntities();

  expect(result).toEqual(mockData);
});
```

---

### createMockQueueManager

Creates a mock QueueManager that produces simple in-memory mock queues for testing.

**Source**: [`packages/test-utils-backend/src/mock-queue-factory.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-queue-factory.ts)

#### Basic Usage

```typescript
import { createMockQueueManager } from "@checkmate/test-utils-backend";

test("should enqueue job", async () => {
  const mockQueueManager = createMockQueueManager();
  const queue = mockQueueManager.getQueue("my-channel");

  const jobId = await queue.enqueue({ task: "process-data" });

  expect(jobId).toBeDefined();
});
```

#### Testing Queue Consumers

```typescript
test("should process queued jobs", async () => {
  const mockQueueManager = createMockQueueManager();
  const queue = mockQueueManager.getQueue("tasks");
  const processedJobs: any[] = [];

  // Register consumer
  await queue.consume(async (job) => {
    processedJobs.push(job.data);
  }, { consumerGroup: "test-group" });

  // Enqueue job (consumer is triggered immediately in mock)
  await queue.enqueue({ task: "send-email" });

  expect(processedJobs).toHaveLength(1);
  expect(processedJobs[0]).toEqual({ task: "send-email" });
});
```

#### Key Features

- **Immediate execution**: Jobs are processed synchronously when enqueued (testing-friendly)
- **Consumer groups**: Supports multiple consumer groups
- **Error handling**: Catches errors like production queues
- **Statistics**: `getStats()` returns current queue state

---

### createMockRpcContext

Creates a complete mock RPC context with all dependencies pre-configured.

**Source**: [`packages/backend-api/src/test-utils.ts`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/backend-api/src/test-utils.ts)

#### Basic Usage

```typescript
import { createMockRpcContext } from "@checkmate/backend-api/test-utils";

test("should handle RPC request", async () => {
  const ctx = createMockRpcContext();
  const result = await myRpcHandler({ ctx, input: { id: "123" } });

  expect(ctx.db.select).toHaveBeenCalled();
  expect(result).toBeDefined();
});
```

#### Context Properties

The mock context includes:

```typescript
interface RpcContext {
  db: MockDb;                    // Chainable database mock
  logger: MockLogger;            // Logger with child() support
  fetch: MockFetch;              // HTTP/inter-plugin requests
  auth: MockAuth;                // Authentication methods
  healthCheckRegistry: MockRegistry;
  queuePluginRegistry: MockRegistry;
  queueManager: MockQueueManager; // Queue management mock
  user?: User;                   // Optional authenticated user
}
```

#### Overriding Properties

You can override specific properties for your test:

```typescript
test("should handle authenticated request", async () => {
  const ctx = createMockRpcContext({
    user: { id: "user-123", email: "test@example.com", role: "admin" },
  });

  const result = await protectedHandler({ ctx, input: {} });

  expect(ctx.user?.role).toBe("admin");
  expect(result).toBeDefined();
});
```

#### Testing Router Handlers

```typescript
import { createMockRpcContext } from "@checkmate/backend-api/test-utils";
import { myRouter } from "./router";

test("should handle getUser RPC call", async () => {
  const ctx = createMockRpcContext();
  const mockUser = { id: "user-1", name: "Alice" };

  (ctx.db.select as any) = mock(() => ({
    from: mock(() => ({
      where: mock(() => Promise.resolve([mockUser])),
    })),
  }));

  const caller = myRouter.createCaller(ctx);
  const result = await caller.getUser({ id: "user-1" });

  expect(result).toEqual(mockUser);
});
```

---

## Common Usage Patterns

### Pattern 1: Testing Services with Database Dependencies

```typescript
import { describe, test, expect } from "bun:test";
import { createMockDb, createMockLogger } from "@checkmate/test-utils-backend";
import { UserService } from "./user-service";

describe("UserService", () => {
  test("should create new user", async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const service = new UserService(mockDb, mockLogger);

    await service.createUser({ name: "Alice", email: "alice@example.com" });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("User created");
  });

  test("should fetch user by ID", async () => {
    const mockDb = createMockDb();
    const mockLogger = createMockLogger();
    const mockUserData = [{ id: "1", name: "Alice" }];

    (mockDb.select as any) = mock(() => ({
      from: mock(() => ({
        where: mock(() => Promise.resolve(mockUserData)),
      })),
    }));

    const service = new UserService(mockDb, mockLogger);
    const result = await service.getUserById("1");

    expect(result).toEqual(mockUserData[0]);
  });
});
```

### Pattern 2: Testing Routers with Full Context

```typescript
import { test, expect } from "bun:test";
import { createMockRpcContext } from "@checkmate/backend-api/test-utils";
import { createUserRouter } from "./router";

test("should handle createUser RPC call", async () => {
  const ctx = createMockRpcContext({
    user: { id: "admin-1", role: "admin" },
  });

  const router = createUserRouter();
  const caller = router.createCaller(ctx);

  await caller.createUser({ name: "Bob", email: "bob@example.com" });

  expect(ctx.db.insert).toHaveBeenCalled();
  expect(ctx.logger.info).toHaveBeenCalled();
});
```

### Pattern 3: Testing Inter-Plugin Communication

```typescript
import { test, expect } from "bun:test";
import { createMockFetch } from "@checkmate/test-utils-backend";
import { CatalogIntegration } from "./catalog-integration";

test("should fetch entities from catalog plugin", async () => {
  const mockFetch = createMockFetch();
  const mockEntities = [{ id: "1", name: "Service A" }];

  (mockFetch.forPlugin as any) = mock(() => ({
    get: mock(() => 
      Promise.resolve({ 
        ok: true, 
        json: () => Promise.resolve({ entities: mockEntities }) 
      })
    ),
  }));

  const integration = new CatalogIntegration(mockFetch);
  const result = await integration.getEntities();

  expect(mockFetch.forPlugin).toHaveBeenCalledWith("catalog-backend");
  expect(result.entities).toEqual(mockEntities);
});
```

### Pattern 4: Testing Queue Consumers

```typescript
import { test, expect } from "bun:test";
import { createMockQueueManager, createMockLogger } from "@checkmate/test-utils-backend";
import { EmailWorker } from "./email-worker";

test("should process email jobs", async () => {
  const mockQueueManager = createMockQueueManager();
  const mockLogger = createMockLogger();
  const worker = new EmailWorker(mockQueueManager, mockLogger);

  const queue = mockQueueManager.getQueue("emails");
  const sentEmails: any[] = [];

  await queue.consume(async (job) => {
    sentEmails.push(job.data);
  }, { consumerGroup: "test-group" });

  await queue.enqueue({ to: "user@example.com", subject: "Test" });

  expect(sentEmails).toHaveLength(1);
  expect(sentEmails[0].to).toBe("user@example.com");
});
```

### Pattern 5: Testing with Child Loggers

```typescript
import { test, expect } from "bun:test";
import { createMockLogger } from "@checkmate/test-utils-backend";
import { MultiStepProcessor } from "./processor";

test("should use child loggers for each step", async () => {
  const mockLogger = createMockLogger();
  const processor = new MultiStepProcessor(mockLogger);

  await processor.run();

  expect(mockLogger.child).toHaveBeenCalledWith({ step: "validate" });
  expect(mockLogger.child).toHaveBeenCalledWith({ step: "transform" });
  expect(mockLogger.child).toHaveBeenCalledWith({ step: "save" });
});
```

---

## Best Practices

### 1. Always Use Centralized Utilities

**❌ Bad**: Recreating mocks locally

```typescript
// DON'T DO THIS
const mockDb = {
  select: mock(() => ({ from: mock(() => Promise.resolve([])) })),
  insert: mock(() => ({ values: mock(() => Promise.resolve()) })),
};
```

**✅ Good**: Import from test utilities

```typescript
import { createMockDb } from "@checkmate/test-utils-backend";

const mockDb = createMockDb();
```

### 2. Avoid Importing from Main Entry Points

**❌ Bad**: Importing from production packages

```typescript
// DON'T DO THIS - triggers production initialization
import { EventBus } from "@checkmate/backend";
```

**✅ Good**: Import only what you need

```typescript
// Import test utilities from dedicated packages
import { createMockQueueManager } from "@checkmate/test-utils-backend";

// Import classes directly (no side effects)
import { EventBus } from "@checkmate/backend/event-bus";
```

### 3. Use Module Mocking for Integration Tests

When testing code that imports modules directly:

```typescript
import { mock } from "bun:test";
import { createMockDbModule } from "@checkmate/test-utils-backend";

// Mock the module before importing the code under test
mock.module("./db", () => createMockDbModule());

// Now this import will use the mock
import { myServiceThatImportsDb } from "./my-service";
```

### 4. Customize Mocks Only When Necessary

Start with the default mock and override only when you need specific behavior:

```typescript
const mockDb = createMockDb();

// Override only the specific method you need
(mockDb.select as any) = mock(() => ({
  from: mock(() => Promise.resolve([{ id: "1", name: "Test" }])),
}));
```

### 5. Test Asynchronous Operations Properly

Always `await` async operations in tests:

```typescript
test("should process async operation", async () => {
  const service = new MyService(mockDb);
  
  // ✅ Await the operation
  await service.processAsync();
  
  expect(mockDb.insert).toHaveBeenCalled();
});
```

### 6. Use Type Assertions for Complex Overrides

When TypeScript complains about mock overrides:

```typescript
// Use 'as any' for type assertion when overriding
(mockDb.select as any) = mock(() => customBehavior);
```

---

## Troubleshooting

### "Cannot read property 'from' of undefined"

**Problem**: The mock chain is broken.

**Solution**: Ensure you're using `createMockDb()` and not manually creating partial mocks:

```typescript
// ✅ Correct
const mockDb = createMockDb();

// ❌ Incorrect
const mockDb = { select: mock() };
```

### "Module evaluation triggered database connection"

**Problem**: Side-effect poisoning from importing production code.

**Solution**: Use module mocking or import directly from sub-paths:

```typescript
// Option 1: Module mocking
mock.module("./db", () => createMockDbModule());

// Option 2: Direct imports (no side effects)
import { MyClass } from "./my-class"; // Not from index
```

### "Mock not being called as expected"

**Problem**: The mock was overridden incorrectly.

**Solution**: Check that you're overriding the right method in the chain:

```typescript
// Verify which method you need to override
(mockDb.select as any) = mock(() => ({
  from: mock(() => ({
    where: mock(() => Promise.resolve([expectedData])),
  })),
}));
```

### "Type error when using createMockRpcContext"

**Problem**: TypeScript can't infer the correct types.

**Solution**: Use type assertions or provide explicit overrides:

```typescript
import { RpcContext } from "@checkmate/backend-api";

const ctx = createMockRpcContext({
  user: { id: "1", email: "test@example.com" } as any,
}) as RpcContext;
```

### "Queue consumer not being called"

**Problem**: The mock queue processes jobs immediately and synchronously.

**Solution**: Remember that `createMockQueueManager` executes consumers immediately when jobs are enqueued:

```typescript
const results: any[] = [];

// Register consumer first
await queue.consume(async (job) => {
  results.push(job.data);
}, { consumerGroup: "test" });

// Then enqueue (triggers consumer immediately)
await queue.enqueue({ data: "test" });

// Results available immediately (no need to wait)
expect(results).toHaveLength(1);
```

---

## Summary

The Checkmate backend test utilities provide:

- **Comprehensive mocking** for all core services (DB, Logger, Fetch, Queue, RPC)
- **Chainable interfaces** that match production behavior
- **Zero configuration** with sensible defaults
- **Side-effect-free** execution to keep tests fast and reliable
- **Centralized maintenance** for consistency across the codebase

Always use these utilities from their dedicated packages (`@checkmate/test-utils-backend`, `@checkmate/backend-api/test-utils`) to ensure clean, maintainable, and reliable tests.

For reference implementations, see:
- [`createMockDb`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-db.ts)
- [`createMockLogger`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-logger.ts)
- [`createMockFetch`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-fetch.ts)
- [`createMockQueueManager`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/test-utils-backend/src/mock-queue-factory.ts)
- [`createMockRpcContext`](file:///Users/nicoenking/Development/Projects/node/checkmate/packages/backend-api/src/test-utils.ts)
