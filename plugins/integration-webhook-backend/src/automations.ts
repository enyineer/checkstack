/**
 * Webhook action — generic HTTP POST/PUT/PATCH to an external endpoint.
 *
 * Replaces the legacy `webhookProvider.deliver` path. All template
 * expansion now happens in the dispatch engine before `execute` is
 * called, so this action just builds the request and fires it.
 */
import { z } from "zod";
import {
  configNumber,
  configString,
  requestTimeoutMs,
  Versioned,
} from "@checkstack/backend-api";
import type { ActionDefinition } from "@checkstack/automation-backend";
import { extractErrorMessage } from "@checkstack/common";

const webhookHeaderSchema = z.object({
  name: z.string().min(1).describe("Header name"),
  value: z.string().describe("Header value"),
});

export const webhookSendConfigSchema = z.object({
  url: configString({}).url().describe("Endpoint URL"),
  method: z
    .enum(["POST", "PUT", "PATCH"])
    .default("POST")
    .describe("HTTP method"),
  contentType: z
    .enum(["application/json", "application/x-www-form-urlencoded"])
    .default("application/json"),
  authType: z
    .enum(["none", "bearer", "basic", "header"])
    .default("none")
    .describe("Authentication method"),
  bearerToken: configString({ "x-secret": true })
    .optional()
    .describe("Bearer token"),
  basicUsername: configString({}).optional(),
  basicPassword: configString({ "x-secret": true }).optional(),
  authHeaderName: configString({}).optional(),
  authHeaderValue: configString({ "x-secret": true }).optional(),
  customHeaders: z.array(webhookHeaderSchema).optional(),
  body: configString({
    "x-editor-types": ["raw", "json", "yaml", "xml", "formdata"],
  })
    .optional()
    .describe("Request body — already rendered when this action runs"),
  timeout: requestTimeoutMs().describe("Request timeout in milliseconds"),
  retryOnStatus: z
    .array(configNumber({}))
    .optional()
    .describe("Retryable HTTP status codes (e.g., 429, 503)"),
});

export type WebhookSendConfig = z.infer<typeof webhookSendConfigSchema>;

interface WebhookDeliveryArtifact {
  url: string;
  status: number;
  externalId?: string;
  responseBody: string;
}

export const webhookSendAction: ActionDefinition<
  WebhookSendConfig,
  WebhookDeliveryArtifact
> = {
  id: "send",
  displayName: "Send Webhook",
  description: "Deliver a payload to an HTTP endpoint",
  category: "Webhook",
  icon: "Webhook",
  config: new Versioned({
    version: 1,
    schema: webhookSendConfigSchema,
  }),
  produces: "delivery",
  execute: async ({ config, logger }) => {
    const headers: Record<string, string> = {
      "Content-Type": config.contentType,
      "User-Agent": "Checkstack-Automation/1.0",
    };

    switch (config.authType) {
      case "bearer": {
        if (config.bearerToken) {
          headers.Authorization = `Bearer ${config.bearerToken}`;
        }
        break;
      }
      case "basic": {
        if (config.basicUsername && config.basicPassword) {
          const credentials = Buffer.from(
            `${config.basicUsername}:${config.basicPassword}`,
          ).toString("base64");
          headers.Authorization = `Basic ${credentials}`;
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

    if (config.customHeaders) {
      for (const header of config.customHeaders) {
        headers[header.name] = header.value;
      }
    }

    const body = config.body ?? "";

    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers,
        body,
        signal: AbortSignal.timeout(config.timeout),
      });

      const responseText = await response.text();

      if (config.retryOnStatus?.includes(response.status)) {
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

      let externalId: string | undefined;
      try {
        const json = JSON.parse(responseText) as Record<string, unknown>;
        const candidate = json.id ?? json.externalId ?? json.messageId;
        if (typeof candidate === "string") externalId = candidate;
      } catch {
        // Not JSON — that's fine, no externalId.
      }

      logger.debug(
        `Webhook delivered to ${config.url}: ${response.status}`,
      );
      return {
        success: true,
        externalId,
        artifact: {
          url: config.url,
          status: response.status,
          externalId,
          responseBody: responseText.slice(0, 1000),
        },
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      logger.error(`Webhook delivery failed: ${message}`);
      if (
        message.includes("timeout") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND")
      ) {
        return { success: false, error: message, retryAfterMs: 30_000 };
      }
      return { success: false, error: message };
    }
  },
};

export const webhookDeliveryArtifactType = {
  id: "delivery",
  displayName: "Webhook Delivery",
  description: "Result of an HTTP delivery attempt",
  schema: z.object({
    url: z.string(),
    status: z.number(),
    externalId: z.string().optional(),
    responseBody: z.string(),
  }),
} as const;
