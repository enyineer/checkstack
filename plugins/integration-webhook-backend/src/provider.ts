import { z } from "zod";
import { Versioned, secret } from "@checkmate-monitor/backend-api";
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
} from "@checkmate-monitor/integration-backend";

// =============================================================================
// Webhook Configuration Schema
// =============================================================================

/**
 * Header configuration for custom HTTP headers.
 */
const webhookHeaderSchema = z.object({
  name: z.string().min(1).describe("Header name"),
  value: z.string().describe("Header value"),
});

/**
 * Webhook provider configuration schema.
 * Supports various authentication methods and customization options.
 */
export const webhookConfigSchemaV1 = z.object({
  url: z.string().url().describe("The webhook endpoint URL to send events to"),
  method: z
    .enum(["POST", "PUT", "PATCH"])
    .default("POST")
    .describe("HTTP method to use"),
  contentType: z
    .enum(["application/json", "application/x-www-form-urlencoded"])
    .default("application/json")
    .describe("Content-Type header for the request"),

  // Authentication
  authType: z
    .enum(["none", "bearer", "basic", "header"])
    .default("none")
    .describe("Authentication method"),
  bearerToken: secret({
    description: "Bearer token for authentication",
  }).optional(),
  basicUsername: z.string().optional().describe("Username for Basic auth"),
  basicPassword: secret({ description: "Password for Basic auth" }).optional(),
  authHeaderName: z
    .string()
    .optional()
    .describe("Custom header name for token auth (e.g., X-API-Key)"),
  authHeaderValue: secret({ description: "Custom header value" }).optional(),

  // Additional options
  customHeaders: z
    .array(webhookHeaderSchema)
    .optional()
    .describe("Additional custom headers to include"),
  timeout: z
    .number()
    .min(1000)
    .max(60_000)
    .default(10_000)
    .describe("Request timeout in milliseconds"),
  retryOnStatus: z
    .array(z.number())
    .optional()
    .describe("HTTP status codes that should trigger a retry (e.g., 429, 503)"),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchemaV1>;

// =============================================================================
// Webhook Provider Implementation
// =============================================================================

/**
 * Webhook integration provider.
 * Delivers events as HTTP POST requests to configured endpoints.
 */
export const webhookProvider: IntegrationProvider<WebhookConfig> = {
  id: "webhook",
  displayName: "Webhook",
  description: "Deliver events via HTTP POST to external endpoints",
  icon: "Webhook",

  config: new Versioned({
    version: 1,
    schema: webhookConfigSchemaV1,
  }),

  documentation: {
    setupGuide: `Your endpoint will receive HTTP POST requests with JSON payloads.

Configure your server to:
1. Accept POST requests at your configured URL
2. Return a 2xx status code on success
3. Optionally return a JSON response with an \`id\` field for tracking`,
    examplePayload: JSON.stringify(
      {
        id: "del_abc123",
        eventType: "incident.created",
        timestamp: "2024-01-15T10:30:00.000Z",
        subscription: {
          id: "sub_xyz",
          name: "My Webhook",
        },
        data: {
          incidentId: "inc_123",
          title: "API degraded performance",
          severity: "warning",
        },
      },
      // eslint-disable-next-line unicorn/no-null
      null,
      2
    ),
    headers: [
      {
        name: "Content-Type",
        description: "application/json (or application/x-www-form-urlencoded)",
      },
      {
        name: "X-Delivery-Id",
        description: "Unique ID for this delivery attempt",
      },
      {
        name: "X-Event-Type",
        description: "The event type (e.g., incident.created)",
      },
      { name: "User-Agent", description: "Checkmate-Integration/1.0" },
    ],
  },

  async deliver(
    context: IntegrationDeliveryContext<WebhookConfig>
  ): Promise<IntegrationDeliveryResult> {
    const { event, subscription, providerConfig, logger } = context;

    // Validate config
    const config = webhookConfigSchemaV1.parse(providerConfig);

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": config.contentType,
      "User-Agent": "Checkmate-Integration/1.0",
      "X-Delivery-Id": event.deliveryId,
      "X-Event-Type": event.eventId,
    };

    // Add authentication headers
    switch (config.authType) {
      case "bearer": {
        if (config.bearerToken) {
          headers["Authorization"] = `Bearer ${config.bearerToken}`;
        }
        break;
      }
      case "basic": {
        if (config.basicUsername && config.basicPassword) {
          const credentials = Buffer.from(
            `${config.basicUsername}:${config.basicPassword}`
          ).toString("base64");
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;
      }
      case "header": {
        if (config.authHeaderName && config.authHeaderValue) {
          headers[config.authHeaderName] = config.authHeaderValue;
        }
        break;
      }
    }

    // Add custom headers
    if (config.customHeaders) {
      for (const header of config.customHeaders) {
        headers[header.name] = header.value;
      }
    }

    // Build request body
    const payload = {
      id: event.deliveryId,
      eventType: event.eventId,
      timestamp: event.timestamp,
      subscription: {
        id: subscription.id,
        name: subscription.name,
      },
      data: event.payload,
    };

    const body =
      config.contentType === "application/json"
        ? JSON.stringify(payload)
        : new URLSearchParams({
            payload: JSON.stringify(payload),
          }).toString();

    logger.debug(
      `Delivering webhook to ${config.url} for event ${event.eventId}`
    );

    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers,
        body,
        signal: AbortSignal.timeout(config.timeout),
      });

      const responseText = await response.text();

      // Check if we should retry based on status code
      if (config.retryOnStatus?.includes(response.status)) {
        // Check for Retry-After header
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterMs = retryAfter
          ? Number.parseInt(retryAfter, 10) * 1000
          : 30_000;

        return {
          success: false,
          error: `Received status ${response.status} (retryable)`,
          retryAfterMs,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        };
      }

      logger.debug(`Webhook delivered successfully: ${response.status}`);

      // Try to extract external ID from response
      let externalId: string | undefined;
      try {
        const json = JSON.parse(responseText);
        externalId = json.id ?? json.externalId ?? json.messageId;
      } catch {
        // Response wasn't JSON, that's fine
      }

      return {
        success: true,
        externalId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Webhook delivery failed: ${message}`);

      // Network errors should trigger retry
      if (
        message.includes("timeout") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND")
      ) {
        return {
          success: false,
          error: message,
          retryAfterMs: 30_000,
        };
      }

      return {
        success: false,
        error: message,
      };
    }
  },

  async testConnection(config: WebhookConfig): Promise<TestConnectionResult> {
    // Validate the configuration
    try {
      webhookConfigSchemaV1.parse(config);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Invalid configuration",
      };
    }

    // Try to reach the URL with a HEAD request to validate it's accessible
    try {
      const headers: Record<string, string> = {
        "User-Agent": "Checkmate-Integration/1.0",
      };

      // Add authentication for the test
      switch (config.authType) {
        case "bearer": {
          if (config.bearerToken) {
            headers["Authorization"] = `Bearer ${config.bearerToken}`;
          }
          break;
        }
        case "basic": {
          if (config.basicUsername && config.basicPassword) {
            const credentials = Buffer.from(
              `${config.basicUsername}:${config.basicPassword}`
            ).toString("base64");
            headers["Authorization"] = `Basic ${credentials}`;
          }
          break;
        }
        case "header": {
          if (config.authHeaderName && config.authHeaderValue) {
            headers[config.authHeaderName] = config.authHeaderValue;
          }
          break;
        }
      }

      const response = await fetch(config.url, {
        method: "HEAD",
        headers,
        signal: AbortSignal.timeout(5000),
      });

      // Accept any response - we just want to verify the endpoint exists
      // Some endpoints might return 404 for HEAD but accept POST
      if (response.status >= 500) {
        return {
          success: false,
          message: `Server error: ${response.status}`,
        };
      }

      return {
        success: true,
        message: `Endpoint reachable (status: ${response.status})`,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? `Connection failed: ${error.message}`
            : "Connection failed",
      };
    }
  },
};
