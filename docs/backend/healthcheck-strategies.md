---
---
# Health Check Strategy Development

## Overview

Health check strategies define how to monitor specific types of services. Each strategy consists of a **configuration schema** (how to run the check) and **assertions** (what to validate in the result).

## Architectural Principles

### Separation of Concerns

A well-designed strategy separates two distinct concerns:

| Concern | Schema Field | Purpose | Examples |
|---------|--------------|---------|----------|
| **Configuration** | `config` | How to connect and run the check | URLs, ports, credentials, timeouts |
| **Assertions** | `assertions` | What conditions must pass | Status codes, response times, content checks |

```typescript
const myHealthCheckConfigSchema = z.object({
  // Configuration: HOW to run the check
  url: z.string().url().describe("Target endpoint"),
  timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  
  // Assertions: WHAT to validate in the result
  assertions: z.array(myAssertionSchema).optional().describe("Validation conditions"),
});
```

> [!IMPORTANT]
> **Do NOT include expected values in configuration.** For example, avoid `expectedStatus: 200`. Instead, use an assertion: `{ field: "statusCode", operator: "equals", value: 200 }`.

### Why Assertions?

1. **Flexibility**: Multiple conditions with different operators (equals, lessThan, contains, etc.)
2. **Composability**: Combine multiple assertions for comprehensive validation
3. **Transparency**: Users see exactly what's being checked in the UI
4. **Extensibility**: New assertion types can be added without changing the core config

## Assertion Patterns

### Using Shared Assertion Factories

The platform provides assertion factories in `@checkmate-monitor/backend-api` for common patterns:

```typescript
import {
  numericField,      // Numbers with comparison operators
  timeThresholdField, // Response time checks
  stringField,       // String pattern matching
  booleanField,      // True/false checks
  enumField,         // Fixed set of values
  jsonPathField,     // JSON body validation
} from "@checkmate-monitor/backend-api";
```

### Creating a Discriminated Union

Use Zod's `discriminatedUnion` to combine multiple assertion types, where `field` is the discriminator:

```typescript
const myAssertionSchema = z.discriminatedUnion("field", [
  // Numeric assertions
  numericField("statusCode", { min: 100, max: 599 }),
  
  // Time threshold assertions  
  timeThresholdField("responseTime"),
  
  // String assertions
  stringField("contentType"),
  
  // Enum assertions (fixed values as dropdown)
  enumField("status", ["SERVING", "NOT_SERVING", "UNKNOWN"]),
]);
```

### Factory Reference

| Factory | Use Case | Generated Schema | UI Rendering |
|---------|----------|------------------|--------------|
| `numericField(name, opts)` | Numeric comparisons | `{ field, operator: NumericOps, value: number }` | Number input + operator select |
| `timeThresholdField(name)` | Latency checks | `{ field, operator: 'lessThan'|'lessThanOrEqual', value }` | Number input with ms label |
| `stringField(name)` | Text matching | `{ field, operator: StringOps, value?: string }` | Text input + operator select |
| `booleanField(name)` | True/false checks | `{ field, operator: 'isTrue'|'isFalse' }` | Operator select only |
| `enumField(name, values)` | Fixed value set | `{ field, operator: 'equals', value: enum }` | Value dropdown |
| `jsonPathField()` | JSON body paths | `{ path, operator, value? }` | Path input + operator + value |

### Custom Assertion Types

For complex assertions that don't fit the factories, create a custom schema:

```typescript
const headerAssertionSchema = z.object({
  field: z.literal("header"),
  headerName: z.string().describe("Response header name"),
  operator: z.enum(["equals", "contains", "exists"]),
  value: z.string().optional(),
});

const myAssertionSchema = z.discriminatedUnion("field", [
  // Factory-based assertions
  numericField("statusCode"),
  
  // Custom assertion
  headerAssertionSchema,
]);
```

## Evaluating Assertions

Use the `evaluateAssertions` utility for standard field-based assertions:

```typescript
import { evaluateAssertions } from "@checkmate-monitor/backend-api";

async execute(config: MyConfig): Promise<HealthCheckResult<MyMetadata>> {
  const response = await this.performCheck(config);
  
  // Build values object with all assertable fields
  const values = {
    statusCode: response.status,
    responseTime: response.latencyMs,
    contentType: response.headers.get("content-type") || "",
  };
  
  // Evaluate standard assertions
  const failedAssertion = evaluateAssertions(config.assertions, values);
  
  if (failedAssertion) {
    return {
      status: "unhealthy",
      latencyMs: response.latencyMs,
      message: `Assertion failed: ${failedAssertion.field} ${failedAssertion.operator}`,
      metadata: { failedAssertion },
    };
  }
  
  return {
    status: "healthy",
    latencyMs: response.latencyMs,
    message: "All assertions passed",
  };
}
```

For custom assertion types, evaluate them separately:

```typescript
// Separate assertions by type
const standardAssertions = [];
const customAssertions = [];

for (const assertion of config.assertions || []) {
  if (assertion.field === "header") {
    customAssertions.push(assertion);
  } else {
    standardAssertions.push(assertion);
  }
}

// Evaluate standard assertions
const failedStandard = evaluateAssertions(standardAssertions, values);
if (failedStandard) return unhealthyResult(failedStandard);

// Evaluate custom assertions
for (const custom of customAssertions) {
  if (!this.evaluateCustomAssertion(custom, response)) {
    return unhealthyResult(custom);
  }
}
```

## Complete Example

Here's a complete example of a health check strategy with proper config/assertion separation:

```typescript
import {
  HealthCheckStrategy,
  HealthCheckResult,
  Versioned,
  z,
  numericField,
  timeThresholdField,
  stringField,
  evaluateAssertions,
} from "@checkmate-monitor/backend-api";

// Assertion schema using discriminated union
const httpAssertionSchema = z.discriminatedUnion("field", [
  numericField("statusCode", { min: 100, max: 599 }),
  timeThresholdField("responseTime"),
  stringField("contentType"),
]);

// Config schema: HOW to run the check
const httpConfigSchema = z.object({
  url: z.string().url().describe("Target URL"),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
  timeout: z.number().min(100).default(5000).describe("Timeout in ms"),
  assertions: z.array(httpAssertionSchema).optional().describe("Validation conditions"),
});

export class HttpHealthCheckStrategy implements HealthCheckStrategy<...> {
  id = "http";
  displayName = "HTTP Health Check";
  
  config = new Versioned({ version: 1, schema: httpConfigSchema });
  
  async execute(config: HttpConfig): Promise<HealthCheckResult<HttpMetadata>> {
    const validated = this.config.validate(config);
    const start = performance.now();
    
    const response = await fetch(validated.url, {
      method: validated.method,
      signal: AbortSignal.timeout(validated.timeout),
    });
    
    const latencyMs = Math.round(performance.now() - start);
    
    // Evaluate assertions
    const failed = evaluateAssertions(validated.assertions, {
      statusCode: response.status,
      responseTime: latencyMs,
      contentType: response.headers.get("content-type") || "",
    });
    
    if (failed) {
      return {
        status: "unhealthy",
        latencyMs,
        message: `Assertion failed: ${failed.field}`,
        metadata: { statusCode: response.status, failedAssertion: failed },
      };
    }
    
    return {
      status: "healthy",
      latencyMs,
      message: `HTTP ${response.status}`,
      metadata: { statusCode: response.status },
    };
  }
}
```

## Migration Guide

If your strategy uses config fields like `expectedStatus` or `expectedValue`, migrate to assertions:

### Before (Anti-pattern)

```typescript
const configSchema = z.object({
  url: z.string().url(),
  expectedStatus: z.number().default(200),  // ❌ Don't embed expectations in config
});
```

### After (Recommended)

```typescript
const assertionSchema = z.discriminatedUnion("field", [
  numericField("statusCode"),
  timeThresholdField("responseTime"),
]);

const configSchema = z.object({
  url: z.string().url(),
  assertions: z.array(assertionSchema).optional(),  // ✅ Flexible validation
});
```

This gives users the flexibility to:
- Check for exact status: `{ field: "statusCode", operator: "equals", value: 200 }`
- Check for ranges: `{ field: "statusCode", operator: "lessThan", value: 300 }`
- Combine multiple checks: status code AND response time AND content type

## Auto-Generated Charts

Health check strategies can automatically generate chart visualizations by annotating schema fields with chart metadata. This eliminates the need to write custom chart components for standard metrics.

### Overview

Use Zod's `.meta()` method to attach chart annotations to result and aggregated result schema fields. These annotations flow through `toJSONSchema()` and are used by the frontend to render appropriate visualizations.

```typescript
const myResultSchema = z.object({
  responseTimeMs: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
  }),
  successRate: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
});
```

### Chart Metadata Keys

| Key | Required | Description |
|-----|----------|-------------|
| `x-chart-type` | ✅ | The chart type to render (see available types below) |
| `x-chart-label` | Optional | Human-readable label (defaults to field name) |
| `x-chart-unit` | Optional | Unit suffix for values (e.g., `ms`, `%`, `days`) |

### Available Chart Types

#### Numeric Types

| Type | Use Case | Best For |
|------|----------|----------|
| `line` | Time series data | Latencies, response times, durations |
| `bar` | Distributions | Status code counts, category breakdowns |
| `counter` | Single numeric values | Counts, totals, exit codes |
| `gauge` | Percentages (0-100) | Success rates, packet loss |

#### Non-Numeric Types

| Type | Use Case | Best For |
|------|----------|----------|
| `boolean` | True/false indicators | Connected state, success flags |
| `text` | String display | Version info, status messages |
| `status` | Error/warning badges | Error messages |

> [!TIP]
> Fields without chart annotations simply won't render - no explicit "hidden" type is needed.


### Per-Run Result Schema

Annotate per-run result fields to show metrics for individual check executions:

```typescript
const myResultSchema = z.object({
  connected: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  serverVersion: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Server Version",
  }),
  failedAssertion: myAssertionSchema.optional().meta({
    "x-chart-type": "hidden",  // Don't visualize
  }),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});
```

### Aggregated Result Schema

Annotate aggregated result fields for bucket-level visualizations:

```typescript
const myAggregatedSchema = z.object({
  avgConnectionTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  successRate: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  statusCodeCounts: z.record(z.string(), z.number()).meta({
    "x-chart-type": "bar",
    "x-chart-label": "Status Code Distribution",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});
```

### Complete Example

```typescript
import {
  HealthCheckStrategy,
  Versioned,
  z,
} from "@checkmate-monitor/backend-api";

// Per-run result with chart annotations
const redisResultSchema = z.object({
  connected: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Connected",
  }),
  connectionTimeMs: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Connection Time",
    "x-chart-unit": "ms",
  }),
  pingTimeMs: z.number().optional().meta({
    "x-chart-type": "line",
    "x-chart-label": "Ping Time",
    "x-chart-unit": "ms",
  }),
  pingSuccess: z.boolean().meta({
    "x-chart-type": "boolean",
    "x-chart-label": "Ping Success",
  }),
  role: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Role",
  }),
  redisVersion: z.string().optional().meta({
    "x-chart-type": "text",
    "x-chart-label": "Redis Version",
  }),
  failedAssertion: redisAssertionSchema.optional().meta({
    "x-chart-type": "hidden",
  }),
  error: z.string().optional().meta({
    "x-chart-type": "status",
    "x-chart-label": "Error",
  }),
});

// Aggregated result with chart annotations
const redisAggregatedSchema = z.object({
  avgConnectionTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Connection Time",
    "x-chart-unit": "ms",
  }),
  avgPingTime: z.number().meta({
    "x-chart-type": "line",
    "x-chart-label": "Avg Ping Time",
    "x-chart-unit": "ms",
  }),
  successRate: z.number().meta({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
  }),
  errorCount: z.number().meta({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
  }),
});

export class RedisHealthCheckStrategy implements HealthCheckStrategy<...> {
  id = "redis";
  displayName = "Redis Health Check";
  
  result = new Versioned({ version: 1, schema: redisResultSchema });
  aggregatedResult = new Versioned({ version: 1, schema: redisAggregatedSchema });
  
  // ... rest of implementation
}
```

### Custom Charts vs Auto-Charts

Auto-generated charts work well for standard metrics. For complex visualizations, use [custom chart components](../frontend/healthcheck-charts.md):

| Feature | Auto-Charts | Custom Charts |
|---------|-------------|---------------|
| Setup effort | Schema annotations only | Full React component |
| Customization | Limited to chart types | Full control |
| Best for | Standard metrics | Complex visualizations |

Auto-charts render alongside custom chart extensions - they complement rather than replace custom visualizations.

## Next Steps

- [Health Check Data Management](./healthcheck-data-management.md) - Storage and aggregation
- [Custom Chart Components](../frontend/healthcheck-charts.md) - Strategy-specific visualizations
- [Plugin Development Guide](./plugins.md) - General plugin development
