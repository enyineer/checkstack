import { z } from "zod";
import { Versioned, configString, requestTimeoutMs } from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
} from "@checkstack/integration-backend";
import { extractErrorMessage } from "@checkstack/common";

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

/**
 * Safe console interface for scripts.
 */
interface SafeConsole {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

// =============================================================================
// Script Execution
// =============================================================================

/**
 * Execute a user script with the given context.
 * Uses Function constructor for isolation while keeping it lightweight.
 */
async function executeScript({
  script,
  context,
  safeConsole,
  timeoutMs,
}: {
  script: string;
  context: ScriptContext;
  safeConsole: SafeConsole;
  timeoutMs: number;
}): Promise<{ result: unknown; error?: string }> {
  try {
    // Create an async function from the script
    // The script can use: context, console, fetch
    const asyncFn = new Function(
      "context",
      "console",
      "fetch",
      `return (async () => { ${script} })();`,
    );

    // Execute with timeout
    const result = await Promise.race([
      asyncFn(context, safeConsole, fetch),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Script execution timed out")),
          timeoutMs,
        ),
      ),
    ]);

    return { result };
  } catch (error) {
    const message = extractErrorMessage(error);
    return { result: undefined, error: message };
  }
}

// =============================================================================
// Script Provider Implementation
// =============================================================================

/**
 * Script integration provider.
 * Executes user-defined TypeScript/JavaScript when events trigger.
 */
export const scriptProvider: IntegrationProvider<ScriptConfig> = {
  id: "script",
  displayName: "Script",
  description: "Execute custom TypeScript/JavaScript code when events trigger",
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
- \`context.subscription.name\` - Your subscription name
- \`console.log/warn/error\` - Logging functions
- \`fetch\` - Make HTTP requests

**Example:**
\`\`\`typescript
// Log the event
console.log("Received event:", context.event.eventId);

// Access payload data
const { title, severity } = context.event.payload;

// Make an HTTP request
const response = await fetch("https://api.example.com/webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title, severity }),
});

// Return an object with id for tracking
return { id: await response.json().then(r => r.id) };
\`\`\``,
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

    // Create a safe console that logs through our logger
    const logs: string[] = [];
    const safeConsole: SafeConsole = {
      log: (...args) => {
        const msg = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        logs.push(`[LOG] ${msg}`);
        logger.debug(`Script log: ${msg}`);
      },
      warn: (...args) => {
        const msg = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        logs.push(`[WARN] ${msg}`);
        logger.warn(`Script warn: ${msg}`);
      },
      error: (...args) => {
        const msg = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        logs.push(`[ERROR] ${msg}`);
        logger.error(`Script error: ${msg}`);
      },
      info: (...args) => {
        const msg = args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" ");
        logs.push(`[INFO] ${msg}`);
        logger.info(`Script info: ${msg}`);
      },
    };

    logger.debug(`Executing script for event ${event.eventId}`);

    // Execute the script
    const { result, error } = await executeScript({
      script: config.script,
      context: scriptContext,
      safeConsole,
      timeoutMs: config.timeout,
    });

    if (error) {
      logger.error(`Script execution failed: ${error}`);
      return {
        success: false,
        error: `Script error: ${error}`,
      };
    }

    logger.debug(`Script executed successfully`);

    // Extract external ID from result if present
    let externalId: string | undefined;
    if (result && typeof result === "object" && "id" in result) {
      externalId = String((result as { id: unknown }).id);
    }

    return {
      success: true,
      externalId,
    };
  },
};
