import { z } from "zod";
import {
  Versioned,
  configString,
  requestTimeoutMs,
  defaultEsmScriptRunner,
  type EsmScriptRunResult,
} from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
} from "@checkstack/integration-backend";

// =============================================================================
// Script Configuration Schema
// =============================================================================

/**
 * Script provider configuration schema.
 * Allows users to write TypeScript/JavaScript code that executes when events trigger.
 */
export const scriptConfigSchemaV1 = z.object({
  script: configString({
    "x-editor-types": ["typescript"],
  }).describe(
    "TypeScript/JavaScript code to execute. Access event data via `context.event.payload`.",
  ),

  timeout: requestTimeoutMs().describe("Maximum execution time in milliseconds"),
});

export type ScriptConfig = z.infer<typeof scriptConfigSchemaV1>;

// =============================================================================
// Script Context Types (for IntelliSense header)
// =============================================================================

/**
 * The context object available to scripts.
 * This type definition is used to generate IntelliSense hints in the editor.
 */
export interface ScriptContext {
  event: {
    /** Fully qualified event ID (e.g., "incident.created") */
    eventId: string;
    /** The event payload - access fields like context.event.payload.title */
    payload: Record<string, unknown>;
    /** ISO timestamp when the event was emitted */
    timestamp: string;
    /** Unique ID for this delivery attempt */
    deliveryId: string;
  };
  subscription: {
    /** Subscription ID */
    id: string;
    /** Subscription name */
    name: string;
  };
}

// =============================================================================
// Executor Adapter
// =============================================================================
//
// Subprocess isolation, env scrubbing, temp-dir lifecycle, and result
// marshalling all live in the shared `EsmScriptRunner` in
// `@checkstack/backend-api`. This provider keeps its own injectable
// executor interface so tests can substitute a mock without touching
// the shared runner.
//
// Why subprocess isolation? The previous version used
// `new Function(script)` in the satellite's main V8 isolate. A
// `manage`-permissioned user could read `process.env` (DB URLs,
// signing keys, queue creds) and exfiltrate them through `result.id`
// — a privilege amplification, because those secrets aren't reachable
// through any legitimate API. The shared runner spawns a fresh Bun
// subprocess with only `SAFE_ENV_VARS` forwarded, so user scripts
// cannot see the satellite's environment.

export interface ScriptExecutor {
  execute(input: {
    script: string;
    context: ScriptContext;
    timeoutMs: number;
  }): Promise<EsmScriptRunResult>;
}

const defaultScriptExecutor: ScriptExecutor = {
  async execute({ script, context, timeoutMs }) {
    return defaultEsmScriptRunner.run({
      script,
      context,
      timeoutMs,
      helperModuleName: "@checkstack/integration",
      helperFunctionName: "defineIntegration",
    });
  },
};

// =============================================================================
// Script Provider Implementation
// =============================================================================

/**
 * Script integration provider.
 *
 * User-defined TypeScript/JavaScript runs in a fresh Bun subprocess on
 * delivery (via the shared `EsmScriptRunner`), with `globalThis.context`
 * set to the event + subscription metadata and `globalThis.defineIntegration`
 * available as the typed return-shape helper. The subprocess receives
 * only a curated env (`SAFE_ENV_VARS`), so satellite secrets stay
 * invisible to user code.
 *
 * Tests can inject a mock `ScriptExecutor` via `createScriptProvider`.
 */
export function createScriptProvider(
  executor: ScriptExecutor = defaultScriptExecutor,
): IntegrationProvider<ScriptConfig> {
  return {
    id: "script",
    displayName: "Script",
    description:
      "Execute custom TypeScript/JavaScript code when events trigger",
    icon: "Code",

    config: new Versioned({
      version: 1,
      schema: scriptConfigSchemaV1,
    }),

    documentation: {
      setupGuide: `Write TypeScript/JavaScript code that runs when events trigger.

Your script has access to:
- \`context.event.payload\` - The event data
- \`context.event.eventId\` - The event type (e.g., "incident.created")
- \`context.event.timestamp\` - ISO timestamp of the event
- \`context.event.deliveryId\` - Unique delivery ID
- \`context.subscription.id\` - Your subscription ID
- \`context.subscription.name\` - Your subscription name
- \`console.log/warn/error\` - Logging functions (forwarded to delivery logs)
- \`fetch\` - Make HTTP requests
- Any module from the Node/Bun standard library (\`node:fs\`, \`node:crypto\`, ...)

The script runs in a fresh Bun subprocess on each delivery and cannot
access the satellite's environment variables (DB credentials etc.).

**Example:**
\`\`\`typescript
import { defineIntegration } from "@checkstack/integration";

export default defineIntegration(async (context) => {
  const { title, severity } = context.event.payload;

  const response = await fetch("https://api.example.com/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, severity }),
  });

  const data = await response.json();
  return { id: data.id };
});
\`\`\`

**Return value:**
- An object with an \`id\` or \`externalId\` field is recorded as the
  delivery's external identifier (visible in the delivery log).
- Throwing or returning a rejected promise marks the delivery as failed.`,
    },

    async deliver(
      ctx: IntegrationDeliveryContext<ScriptConfig>,
    ): Promise<IntegrationDeliveryResult> {
      const { event, subscription, providerConfig, logger } = ctx;

      // Validate and parse config
      const config = scriptConfigSchemaV1.parse(providerConfig);

      // Build the script context
      const scriptContext: ScriptContext = {
        event: {
          eventId: event.eventId,
          payload: event.payload,
          timestamp: event.timestamp,
          deliveryId: event.deliveryId,
        },
        subscription: {
          id: subscription.id,
          name: subscription.name,
        },
      };

      logger.debug(`Executing script for event ${event.eventId}`);

      const execResult = await executor.execute({
        script: config.script,
        context: scriptContext,
        timeoutMs: config.timeout,
      });

      // Forward any captured stdout / stderr to the logger so they're
      // visible in the delivery log. The previous in-process
      // implementation logged synchronously as console.log fired; the
      // subprocess model batches it. Same visibility for the operator
      // either way.
      if (execResult.stdout.length > 0) {
        for (const line of execResult.stdout.split("\n")) {
          if (line.length > 0) logger.debug(`Script log: ${line}`);
        }
      }
      // User-script `console.warn` and `console.error` both end up on
      // stderr (Bun matches Node behaviour). The subprocess model can't
      // distinguish the two post-hoc, so we forward every stderr line
      // to `logger.error` — being slightly noisier on a `console.warn`
      // is preferable to losing visibility on a `console.error`.
      if (execResult.stderr.length > 0) {
        for (const line of execResult.stderr.split("\n")) {
          if (line.length > 0) logger.error(`Script stderr: ${line}`);
        }
      }

      if (execResult.timedOut) {
        logger.error("Script execution timed out");
        return {
          success: false,
          error: "Script execution timed out",
        };
      }

      if (execResult.error !== undefined) {
        logger.error(`Script execution failed: ${execResult.error}`);
        return {
          success: false,
          error: `Script error: ${execResult.error}`,
        };
      }

      logger.debug(`Script executed successfully`);

      // Extract external ID from the result if present. Accepts either
      // `{ id }` or `{ externalId }` — both forms are documented.
      let externalId: string | undefined;
      const result = execResult.result;
      if (result && typeof result === "object") {
        const obj = result as Record<string, unknown>;
        if (typeof obj.id === "string" || typeof obj.id === "number") {
          externalId = String(obj.id);
        } else if (
          typeof obj.externalId === "string" ||
          typeof obj.externalId === "number"
        ) {
          externalId = String(obj.externalId);
        }
      }

      return {
        success: true,
        externalId,
      };
    },
  };
}

/**
 * Default scriptProvider instance using the subprocess executor. The
 * factory `createScriptProvider` is exported separately so tests can
 * inject a mock executor; production code should use this constant.
 */
export const scriptProvider: IntegrationProvider<ScriptConfig> =
  createScriptProvider();
