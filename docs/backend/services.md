---
---
# Backend Service-to-Service Communication

## Overview

Backend plugins communicate with each other using **typed RPC clients**. This provides type safety, automatic authentication, and a consistent developer experience across the platform.

## Quick Start

For service-to-service calls between backend plugins, use the `rpcClient` core service:

```typescript
import { coreServices } from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";

env.registerInit({
  deps: {
    rpcClient: coreServices.rpcClient,
  },
  init: async ({ rpcClient }) => {
    // Get typed client for target plugin using its Api definition
    const authClient = rpcClient.forPlugin(AuthApi);
    
    // Make type-safe call
    const { allowRegistration } = await authClient.getRegistrationStatus();
  },
});
```

## Core Services for Communication

### 1. `rpcClient` - Typed RPC Communication (Recommended)

**Use for:** All oRPC procedure calls between backend plugins

```typescript
import { TargetApi } from "@checkstack/target-common";

const client = rpcClient.forPlugin(TargetApi);
const result = await client.someProcedure({ input: "data" });
```

**Benefits:**
- ✅ Full TypeScript type safety with automatic type inference
- ✅ Automatic service token authentication
- ✅ Contract-driven development
- ✅ IDE autocomplete and error checking

### 2. `fetch` - Raw HTTP Requests (Rarely Needed)

**Use for:** External REST APIs or non-oRPC endpoints only

```typescript
const response = await fetch.fetch("https://external-api.com/data");
const data = await response.json();
```

**When you might need fetch:**
- Calling external third-party REST APIs
- Integrating with legacy HTTP endpoints
- Custom protocol requirements

> **Important:** Almost all backend-to-backend communication should use `rpcClient`. The `fetch` service is provided for edge cases and external integrations.

## Complete Example: LDAP → Auth Backend

This demonstrates best practices for inter-plugin communication.

### Step 1: Define Contract (Common Package)

```typescript
// plugins/auth-common/src/rpc-contract.ts
import { oc } from "@orpc/contract";
import { createClientDefinition } from "@checkstack/common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

export const authContract = {
  getRegistrationStatus: oc
    .meta({ access: [] }) // Public endpoint
    .output(z.object({ 
      allowRegistration: z.boolean().describe(
        "When enabled, new users can create accounts. When disabled, only existing users can sign in."
      )
    })),
    
  setRegistrationStatus: oc
    .meta({ access: [access.registrationManage] })
    .input(z.object({ 
      allowRegistration: z.boolean() 
    }))
    .output(z.object({ 
      success: z.boolean() 
    })),
};

// Create typed Api definition for type-safe forPlugin usage
// Pass pluginMetadata directly - enforces using the centralized metadata
export const AuthApi = createClientDefinition(authContract, pluginMetadata);
```

### Step 2: Implement Backend (Backend Plugin)

```typescript
// plugins/auth-backend/src/router.ts
import { implement } from "@orpc/server";
import { authContract } from "@checkstack/auth-common";

const os = implement(authContract).$context<RpcContext>();

export const createAuthRouter = (configService: ConfigService) => {
  const getRegistrationStatus = os.getRegistrationStatus.handler(async () => {
    const config = await configService.get(
      "platform.registration",
      platformRegistrationConfigV1,
      1
    );
    return { allowRegistration: config?.allowRegistration ?? true };
  });

  const setRegistrationStatus = os.setRegistrationStatus.handler(
    async ({ input }) => {
      await configService.set(
        "platform.registration",
        platformRegistrationConfigV1,
        1,
        { allowRegistration: input.allowRegistration }
      );
      return { success: true };
    }
  );

  return os.router({
    getRegistrationStatus,
    setRegistrationStatus,
  });
};
```

### Step 3: Call from Consumer (LDAP Plugin)

```typescript
// plugins/auth-ldap-backend/src/index.ts
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { AuthApi } from "@checkstack/auth-common";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register: (env) => {
    env.registerInit({
      deps: {
        rpcClient: coreServices.rpcClient,
        logger: coreServices.logger,
        // ... other deps
      },
      init: async ({ rpcClient, logger }) => {
        // Get typed client using Api definition
        const authClient = rpcClient.forPlugin(AuthApi);
        
        // Somewhere in your logic...
        try {
          const { allowRegistration } = 
            await authClient.getRegistrationStatus();
          
          if (!allowRegistration) {
            throw new Error("Registration is disabled");
          }
          
          // Continue with user creation...
        } catch (error) {
          logger.error("Failed to check registration status:", error);
          // Handle error appropriately
        }
      },
    });
  },
});
```

## Best Practices

### ✅ DO

1. **Always use typed clients via Api definitions**
   ```typescript
   import { MyApi } from "@checkstack/my-common";
   
   const client = rpcClient.forPlugin(MyApi);
   const result = await client.myProcedure({ id: "123" });
   ```

2. **Export Api definitions from common packages**
   ```typescript
   // my-plugin-common/src/rpc-contract.ts
   import { createClientDefinition } from "@checkstack/common";
   import { pluginMetadata } from "./plugin-metadata";
   
   // Pass pluginMetadata directly - enforces centralized metadata
   export const MyApi = createClientDefinition(myContract, pluginMetadata);
   ```

3. **Handle errors gracefully**
   ```typescript
   try {
     const result = await client.doSomething();
   } catch (error) {
     logger.error("RPC call failed:", error);
     // Provide fallback or propagate
   }
   ```

4. **Document cross-plugin dependencies**
   ```typescript
   /**
    * Calls auth-backend to verify registration status.
    * @requires auth-backend plugin
    */
   const checkRegistration = async () => { ... }
   ```

### ❌ DON'T

1. **Don't use fetch for oRPC procedures**
   ```typescript
   // ❌ BAD: Raw fetch for oRPC
   const response = await fetch.forPlugin("auth-backend").post(
     "getRegistrationStatus", 
     {}
   );
   const data = await response.json(); // No type safety!
   
   // ✅ GOOD: Typed RPC client with Api definition
   import { AuthApi } from "@checkstack/auth-common";
   const authClient = rpcClient.forPlugin(AuthApi);
   const { allowRegistration } = await authClient.getRegistrationStatus();
   ```

2. **Don't use string-based forPlugin (legacy pattern)**
   ```typescript
   // ❌ LEGACY: Type-only import with string plugin ID
   const client = rpcClient.forPlugin<AuthClient>("auth-backend");
   
   // ✅ CURRENT: Api definition with automatic type inference
   const client = rpcClient.forPlugin(AuthApi);
   ```

3. **Don't make blocking calls without error handling**
   ```typescript
   // ❌ BAD: No error handling
   const result = await client.criticalOperation();
   
   // ✅ GOOD: Graceful error handling
   try {
     const result = await client.criticalOperation();
   } catch (error) {
     logger.error("Operation failed:", error);
     return defaultValue;
   }
   ```

4. **Don't depend on frontend packages**
   ```typescript
   // ❌ BAD: Backend depending on frontend
   import { something } from "@my-plugin/frontend";
   
   // ✅ GOOD: Use common package
   import { something } from "@my-plugin/common";
   ```

## Authentication

Service-to-service calls are automatically authenticated with **service tokens**:

1. Each plugin receives a scoped `rpcClient` via dependency injection
2. The client automatically includes service tokens in all requests
3. Service tokens grant full access (`*`) to bypass authorization
4. Target plugin sees the request as coming from a trusted service

You don't need to handle authentication manually - it's automatic!

## Error Handling

RPC calls throw standard oRPC errors. Always wrap calls in try/catch:

```typescript
import { ORPCError } from "@orpc/server";

try {
  const result = await client.myProcedure({ id: "123" });
} catch (error) {
  if (error instanceof ORPCError) {
    // Handle known oRPC errors
    logger.error(`RPC error [${error.code}]:`, error.message);
  } else {
    // Handle unexpected errors
    logger.error("Unexpected error:", error);
  }
  
  // Decide: throw, return default, or retry
  throw error;
}
```

## Testing

Use mock RPC clients in tests:

```typescript
import { describe, it, expect, mock } from "bun:test";
import { AuthApi } from "@checkstack/auth-common";
import type { InferClient } from "@checkstack/common";

describe("My Service", () => {
  it("checks registration status", async () => {
    // Create mock client that matches the Api's inferred type
    const mockAuthClient: InferClient<typeof AuthApi> = {
      getRegistrationStatus: mock(() => 
        Promise.resolve({ allowRegistration: false })
      ),
      // ... other methods
    } as InferClient<typeof AuthApi>;
    
    // Create mock rpcClient
    const mockRpcClient = {
      forPlugin: mock(() => mockAuthClient),
    };
    
    // Test your code with the mock
    // ...
  });
});
```

## Migration Guide

If you have existing code using `fetch.forPlugin()` for RPC calls:

### Before (Not Recommended)

```typescript
const fetchService = await deps.fetch;
const response = await fetchService.forPlugin("auth-backend").post(
  "getRegistrationStatus",
  {}
);

if (response.ok) {
  const data = await response.json();
  // No type safety on data
  if (!data.allowRegistration) {
    throw new Error("Registration disabled");
  }
}
```

### After (Recommended)

```typescript
import { AuthApi } from "@checkstack/auth-common";

const authClient = rpcClient.forPlugin(AuthApi);
const { allowRegistration } = await authClient.getRegistrationStatus();

if (!allowRegistration) {
  throw new Error("Registration disabled");
}
```

**Benefits of migration:**
- Full type safety on input and output
- Autocomplete in IDE
- Compile-time error checking
- Less boilerplate code
- Better error messages

## When to Use Fetch Service

The `fetch` service is still available for specific use cases:

### External REST APIs

```typescript
const response = await fetch.fetch("https://api.github.com/repos/owner/repo");
const repoData = await response.json();
```

### Legacy HTTP Endpoints

```typescript
const response = await fetch.forPlugin("legacy-service").get("/old-endpoint");
```

### Custom Protocols or Binary Data

```typescript
const response = await fetch.fetch("https://cdn.example.com/file.pdf");
const blob = await response.blob();
```

## Architecture Details

### How RPC Client Works

1. **Factory Registration**: The `rpcClient` service is registered in `PluginManager`
2. **Scoped Instances**: Each plugin gets its own authenticated client
3. **Fetch Reuse**: Uses existing `fetch` service (no auth duplication)
4. **oRPC Link**: Creates `RPCLink` pointing to `/api` with authenticated fetch
5. **Type Casting**: Returns typed client via `forPlugin<T>()` method

### Code Reference

```typescript
// core/backend/src/plugin-manager.ts
this.registry.registerFactory(coreServices.rpcClient, async (pluginId) => {
  const fetchService = await this.registry.get(coreServices.fetch, pluginId);
  const apiBaseUrl = process.env.API_BASE_URL || "http://localhost:3000";

  const link = new RPCLink({
    url: `${apiBaseUrl}/api`,
    fetch: fetchService.fetch, // Reuses authenticated fetch
  });

  const client = createORPCClient(link);

  return {
    forPlugin<T>(targetPluginId: string): T {
      return (client as Record<string, T>)[targetPluginId];
    },
  };
});
```

## Summary

- **Use `rpcClient`** for all backend-to-backend oRPC calls (99% of cases)
- **Use `fetch`** only for external REST APIs or legacy HTTP endpoints
- **Always use Api definitions** with `forPlugin(*Api)` for automatic type inference
- **Handle errors** with try/catch blocks
- **Export Api definitions** from common packages using `createClientDefinition`
- **Service authentication** is automatic

For questions or issues, refer to the [oRPC documentation](https://orpc.unnoq.com/) or check existing plugin implementations.
