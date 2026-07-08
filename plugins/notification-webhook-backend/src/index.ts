import { z } from "zod";
import {
  createBackendPlugin,
  configString,
  configNumber,
  Versioned,
  type NotificationStrategy,
  type NotificationSendContext,
  type NotificationDeliveryResult,
} from "@checkstack/backend-api";
import {
  notificationStrategyExtensionPoint,
  postJson,
  validateWebhookUrl,
} from "@checkstack/notification-backend";
import { pluginMetadata } from "./plugin-metadata";
import { buildWebhookPayload } from "./payload";
import { buildSignatureHeaders } from "./signing";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Configuration Schemas
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Admin-global config: just the request timeout (no shared credentials). */
const webhookConfigSchemaV1 = z.object({
  timeoutSeconds: configNumber({})
    .min(1)
    .max(60)
    .default(10)
    .describe("Request timeout in seconds"),
});

type WebhookConfig = z.infer<typeof webhookConfigSchemaV1>;

/** Per-user config: the destination URL and an optional signing secret. */
const webhookUserConfigSchemaV1 = z.object({
  url: configString({})
    .url()
    .describe("Webhook URL to POST notifications to (https recommended)"),
  signingSecret: configString({ "x-secret": true })
    .optional()
    .describe(
      "Optional shared secret. When set, requests carry an HMAC-SHA256 signature header so your receiver can verify authenticity.",
    ),
});

type WebhookUserConfig = z.infer<typeof webhookUserConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Instructions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const adminInstructions = `
## Generic outgoing webhooks

This channel lets each user register their own HTTPS endpoint. Checkstack POSTs a
JSON payload to that URL for every notification the user is subscribed to.

- Users configure their own URL (and optional signing secret) in their personal
  notification settings.
- URLs that resolve to loopback, private/internal, cloud-metadata, or link-local
  addresses are rejected to prevent server-side request forgery (SSRF).
- Set a request **timeout** below.
`.trim();

const userInstructions = `
## Set up your webhook

1. Enter the **URL** of a publicly reachable HTTPS endpoint you control.
2. Optionally set a **signing secret**. When set, each request includes an
   \`X-Checkstack-Signature\` header (\`sha256=<hmac>\`) computed over
   \`<timestamp>.<body>\`, plus an \`X-Checkstack-Timestamp\` header. Verify it
   with the same secret to confirm the request came from Checkstack.
3. The request body is a stable JSON envelope (\`version\`, \`type\`, \`title\`,
   \`body\`, \`importance\`, \`action\`, \`subjects\`, \`timestamp\`).

> **Note**: Internal/private addresses are blocked for security.
`.trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const webhookStrategy: NotificationStrategy<WebhookConfig, WebhookUserConfig> = {
  id: "webhook",
  displayName: "Webhook",
  description: "POST notifications as JSON to a user-supplied URL",
  icon: "Webhook",

  config: new Versioned({
    version: 1,
    schema: webhookConfigSchemaV1,
  }),

  contactResolution: { type: "user-config", field: "url" },

  userConfig: new Versioned({
    version: 1,
    schema: webhookUserConfigSchemaV1,
  }),

  adminInstructions,
  userInstructions,

  async send(
    context: NotificationSendContext<WebhookConfig, WebhookUserConfig>,
  ): Promise<NotificationDeliveryResult> {
    const { contact, userConfig, notification, strategyConfig, logger } =
      context;

    // `contact` is the resolved `url` field (contactResolution), but guard
    // against an empty/missing URL explicitly.
    const url = contact || userConfig?.url;
    if (!url) {
      return {
        success: false,
        error: "No webhook URL configured.",
      };
    }

    // SSRF guard: reject URLs that resolve to internal/reserved addresses
    // BEFORE dispatching. Reuses the platform egress guard.
    const validation = await validateWebhookUrl({ url });
    if (!validation.ok) {
      logger.warn(`Blocked webhook delivery to ${url}: ${validation.error}`);
      return { success: false, error: validation.error };
    }

    const payload = buildWebhookPayload({ notification });
    // Sign the exact bytes postJson will serialize (it JSON.stringifies the
    // same object, so this string matches what is sent on the wire).
    const rawBody = JSON.stringify(payload);
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const signatureHeaders = buildSignatureHeaders({
      secret: userConfig?.signingSecret,
      rawBody,
      timestampSeconds,
    });

    const result = await postJson({
      url,
      body: payload,
      headers: {
        "User-Agent": "Checkstack-Webhook/1.0",
        ...signatureHeaders,
      },
      timeoutMs: strategyConfig.timeoutSeconds * 1000,
      // Refuse redirects: the SSRF guard only validated the ORIGINAL host, so a
      // 3xx to an internal/metadata host would bypass it. Fail closed instead.
      redirect: "error",
      serviceName: "Webhook",
      logger,
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }
    return { success: true };
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const extensionPoint = env.getExtensionPoint(
      notificationStrategyExtensionPoint,
    );
    extensionPoint.addStrategy(webhookStrategy, pluginMetadata);
  },
});

/**
 * Internal exports for the package's own unit tests. Not part of the plugin's
 * public API surface.
 * @internal
 */
export { webhookConfigSchemaV1, webhookUserConfigSchemaV1 };
/** @internal */
export type { WebhookConfig, WebhookUserConfig };
