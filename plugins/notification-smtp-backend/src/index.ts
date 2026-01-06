import {
  createBackendPlugin,
  type NotificationStrategy,
  Versioned,
  secret,
  color,
  markdownToHtml,
  markdownToPlainText,
  wrapInEmailLayout,
} from "@checkmate-monitor/backend-api";
import { notificationStrategyExtensionPoint } from "@checkmate-monitor/notification-backend";
import { z } from "zod";
import { createTransport, type Transporter } from "nodemailer";
import { pluginMetadata } from "./plugin-metadata";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SMTP Configuration Schema
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * SMTP configuration schema with versioning support.
 * Uses secret() for sensitive fields.
 */
const smtpConfigSchemaV1 = z.object({
  host: z.string().optional().describe("SMTP server hostname"),
  port: z.number().default(587).describe("SMTP server port"),
  secure: z.boolean().default(false).describe("Use TLS/SSL (port 465)"),
  username: secret({ description: "SMTP username" }).optional(),
  password: secret({ description: "SMTP password" }).optional(),
  fromAddress: z.string().email().optional().describe("Sender email address"),
  fromName: z.string().optional().describe("Sender display name"),
});

type SmtpConfig = z.infer<typeof smtpConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Email Layout Configuration Schema (Admin-Customizable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Layout configuration for email styling.
 * Admins can customize branding via the settings UI.
 */
const smtpLayoutConfigSchemaV1 = z.object({
  logoUrl: z.string().url().optional().describe("Logo URL (max 200px wide)"),
  primaryColor: color({
    description: "Primary brand color (hex)",
    defaultValue: "#3b82f6",
  }),
  accentColor: color({ description: "Accent color for buttons" }).optional(),
  footerText: z
    .string()
    .default("This is an automated notification.")
    .describe("Footer text"),
});

type SmtpLayoutConfig = z.infer<typeof smtpLayoutConfigSchemaV1>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SMTP Strategy Implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const smtpStrategy: NotificationStrategy<
  SmtpConfig,
  undefined,
  SmtpLayoutConfig
> = {
  id: "smtp",
  displayName: "Email (SMTP)",
  description: "Send notifications via email using SMTP",
  icon: "mail",

  config: new Versioned({
    version: 1,
    schema: smtpConfigSchemaV1,
  }),

  layoutConfig: new Versioned({
    version: 1,
    schema: smtpLayoutConfigSchemaV1,
  }),

  contactResolution: { type: "auth-email" },

  adminInstructions: `
## SMTP Configuration

Configure your SMTP server to enable email notifications:

1. Enter your SMTP server **hostname** and **port** (587 for TLS, 465 for SSL)
2. If authentication is required, provide **username** and **password**
3. Set the **sender email address** (must be valid for your mail server)
4. Optionally configure a **display name** for the sender

> **Tip**: For Gmail, use \`smtp.gmail.com\` port 587 with an App Password.
`.trim(),

  async send({ contact, notification, strategyConfig, layoutConfig }) {
    // Validate required config
    if (!strategyConfig.host || !strategyConfig.fromAddress) {
      return {
        success: false,
        error: "SMTP is not configured. Please configure host and fromAddress.",
      };
    }

    // Create transporter
    const transporter: Transporter = createTransport({
      host: strategyConfig.host,
      port: strategyConfig.port,
      secure: strategyConfig.secure,
      auth: strategyConfig.username
        ? {
            user: strategyConfig.username,
            pass: strategyConfig.password,
          }
        : undefined,
    });

    // Construct sender field
    const from = strategyConfig.fromName
      ? `"${strategyConfig.fromName}" <${strategyConfig.fromAddress}>`
      : strategyConfig.fromAddress;

    // Convert markdown body to HTML (if provided)
    const bodyHtml = notification.body ? markdownToHtml(notification.body) : "";

    // Generate plain text fallback
    const plainText = notification.body
      ? markdownToPlainText(notification.body)
      : notification.title;

    // Wrap content in the email layout with admin customizations
    const html = wrapInEmailLayout({
      title: notification.title,
      bodyHtml,
      importance: notification.importance,
      action: notification.action,
      logoUrl: layoutConfig?.logoUrl,
      primaryColor: layoutConfig?.primaryColor,
      accentColor: layoutConfig?.accentColor,
      footerText: layoutConfig?.footerText,
    });

    try {
      const result = await transporter.sendMail({
        from,
        to: contact,
        subject: notification.title,
        text: plainText,
        html,
      });

      return {
        success: true,
        externalId: result.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plugin Definition
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Get the notification strategy extension point
    const extensionPoint = env.getExtensionPoint(
      notificationStrategyExtensionPoint
    );

    // Register the SMTP strategy with our plugin metadata
    extensionPoint.addStrategy(smtpStrategy, pluginMetadata);
  },
});
