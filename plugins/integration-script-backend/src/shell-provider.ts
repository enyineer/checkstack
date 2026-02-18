import { spawn, type Subprocess } from "bun";
import { z } from "zod";
import { Versioned, configString, configNumber } from "@checkstack/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
} from "@checkstack/integration-backend";

// =============================================================================
// Bash Configuration Schema
// =============================================================================

/**
 * Bash provider configuration schema.
 * Executes shell scripts with event context available as environment variables.
 */
export const shellConfigSchemaV1 = z.object({
  script: configString({
    "x-editor-types": ["shell"],
  }).describe(
    "Bash script to execute. Event context is available via environment variables (e.g., $EVENT_ID, $PAYLOAD_*).",
  ),

  timeout: configNumber({})
    .min(1000)
    .max(300_000)
    .default(30_000)
    .describe("Maximum execution time in milliseconds"),

  workingDirectory: z
    .string()
    .optional()
    .describe("Working directory for script execution"),
});

export type ShellConfig = z.infer<typeof shellConfigSchemaV1>;

// =============================================================================
// Environment Variable Helpers
// =============================================================================

/**
 * Convert a key to a valid environment variable name.
 * - Converts to uppercase
 * - Replaces dots and dashes with underscores
 * - Prefixes with PAYLOAD_ for payload fields
 */
function toEnvKey(path: string, prefix: string = ""): string {
  const key = path
    .toUpperCase()
    .replaceAll(/[.-]/g, "_")
    .replaceAll(/[^A-Z0-9_]/g, "");
  return prefix ? `${prefix}_${key}` : key;
}

/**
 * Flatten an object into environment variable key-value pairs.
 * Nested objects are flattened with underscore separators.
 */
function flattenToEnv(
  obj: Record<string, unknown>,
  prefix: string = "",
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const envKey = toEnvKey(key, prefix);

    if (value === null || value === undefined) {
      env[envKey] = "";
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Recursively flatten nested objects
      Object.assign(
        env,
        flattenToEnv(value as Record<string, unknown>, envKey),
      );
    } else if (Array.isArray(value)) {
      // Arrays are JSON-encoded
      env[envKey] = JSON.stringify(value);
    } else {
      env[envKey] = String(value);
    }
  }

  return env;
}

// =============================================================================
// Script Execution
// =============================================================================

interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const SAFE_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "HOSTNAME",
  "SHELL",
];

/**
 * Execute a bash script with the given environment variables.
 */
async function executeBashScript({
  script,
  env,
  cwd,
  timeoutMs,
}: {
  script: string;
  env: Record<string, string>;
  cwd?: string;
  timeoutMs: number;
}): Promise<ScriptExecutionResult> {
  let proc: Subprocess | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      proc?.kill();
      reject(new Error("Script execution timed out"));
    }, timeoutMs);
  });

  const safeEnv: Record<string, string> = {};
  for (const key of SAFE_ENV_VARS) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key]!;
    }
  }

  try {
    // Execute script via bash -c
    proc = spawn({
      cmd: ["sh", "-c", script],
      cwd,
      env: { ...safeEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
        proc.exited,
      ]),
      timeoutPromise,
    ]);

    return {
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timedOut: false,
    };
  } catch (error) {
    if (timedOut) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: "Script execution timed out",
        timedOut: true,
      };
    }
    throw error;
  }
}

// =============================================================================
// Shell Provider Implementation
// =============================================================================

/**
 * Shell integration provider.
 * Executes shell scripts when events trigger, with context available via
 * environment variables.
 *
 * Environment variables provided:
 * - EVENT_ID: The fully qualified event ID
 * - EVENT_TIMESTAMP: ISO timestamp of the event
 * - DELIVERY_ID: Unique delivery ID
 * - SUBSCRIPTION_ID: Subscription ID
 * - SUBSCRIPTION_NAME: Subscription name
 * - PAYLOAD_*: Flattened event payload fields
 */
export const shellProvider: IntegrationProvider<ShellConfig> = {
  id: "shell",
  displayName: "Shell Script",
  description: "Execute shell scripts when events trigger",
  icon: "Terminal",

  config: new Versioned({
    version: 1,
    schema: shellConfigSchemaV1,
  }),

  documentation: {
    setupGuide: `Write a Bash script that runs when events trigger.

Event context is available via environment variables:

**Core Variables:**
- \`$EVENT_ID\` - Event type (e.g., "incident.created")
- \`$EVENT_TIMESTAMP\` - ISO timestamp when event occurred
- \`$DELIVERY_ID\` - Unique delivery ID
- \`$SUBSCRIPTION_ID\` - Your subscription ID
- \`$SUBSCRIPTION_NAME\` - Your subscription name

**Payload Variables:**
All event payload fields are available as \`$PAYLOAD_*\` variables.
Nested fields use underscores: \`$PAYLOAD_INCIDENT_TITLE\`

**Example:**
\`\`\`bash
#!/bin/bash
echo "Received event: $EVENT_ID"
echo "Incident title: $PAYLOAD_TITLE"
echo "Severity: $PAYLOAD_SEVERITY"

# Make an HTTP request
curl -X POST "https://api.example.com/webhook" \\
  -H "Content-Type: application/json" \\
  -d "{\\"title\\": \\"$PAYLOAD_TITLE\\", \\"severity\\": \\"$PAYLOAD_SEVERITY\\"}"

# Exit code 0 = success
exit 0
\`\`\`

**Success/Failure:**
- Exit code 0 = success
- Any other exit code = failure`,
  },

  async deliver(
    ctx: IntegrationDeliveryContext<ShellConfig>,
  ): Promise<IntegrationDeliveryResult> {
    const { event, subscription, providerConfig, logger } = ctx;

    // Validate and parse config
    const config = shellConfigSchemaV1.parse(providerConfig);

    // Build environment variables for the script
    const env: Record<string, string> = {
      // Core event info
      EVENT_ID: event.eventId,
      EVENT_TIMESTAMP: event.timestamp,
      DELIVERY_ID: event.deliveryId,

      // Subscription info
      SUBSCRIPTION_ID: subscription.id,
      SUBSCRIPTION_NAME: subscription.name,

      // Flatten payload into PAYLOAD_* variables
      ...flattenToEnv(event.payload, "PAYLOAD"),
    };

    logger.debug(`Executing bash script for event ${event.eventId}`);
    logger.debug(
      `Environment variables: ${Object.keys(env)
        .filter((k) => k.startsWith("PAYLOAD_"))
        .join(", ")}`,
    );

    try {
      const result = await executeBashScript({
        script: config.script,
        env,
        cwd: config.workingDirectory,
        timeoutMs: config.timeout,
      });

      if (result.timedOut) {
        logger.error("Script execution timed out");
        return {
          success: false,
          error: "Script execution timed out",
        };
      }

      if (result.exitCode !== 0) {
        logger.error(
          `Script failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        );
        return {
          success: false,
          error:
            `Script exited with code ${result.exitCode}: ${result.stderr || result.stdout}`.slice(
              0,
              500,
            ),
        };
      }

      logger.debug(
        `Script executed successfully: ${result.stdout.slice(0, 200)}`,
      );

      return {
        success: true,
        // Use first line of stdout as external ID if present
        externalId: result.stdout.split("\n")[0]?.slice(0, 100) || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Script execution failed: ${message}`);
      return {
        success: false,
        error: `Execution error: ${message}`,
      };
    }
  },
};
