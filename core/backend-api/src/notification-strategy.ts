import type { Versioned, VersionedRecord } from "./config-versioning";
import type { PluginMetadata, LucideIconName } from "@checkmate-monitor/common";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Contact Resolution Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Defines how a notification strategy resolves user contact information.
 */
export type NotificationContactResolution =
  | { type: "auth-email" } // Uses user.email from auth system
  | { type: "auth-provider"; provider: string } // Uses email from specific OAuth provider
  | { type: "user-config"; field: string } // User provides via settings form (e.g., phone number)
  | { type: "oauth-link" }; // Requires OAuth flow (Slack, Discord)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Payload and Result Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The notification content to send via external channel.
 */
export interface NotificationPayload {
  /** Notification title/subject */
  title: string;
  /**
   * Markdown-formatted body content.
   * Strategies that support rich rendering will parse this.
   * Strategies that don't (e.g., SMS) will convert to plain text.
   */
  body?: string;
  /** Importance level for visual differentiation */
  importance: "info" | "warning" | "critical";
  /**
   * Optional call-to-action with custom label.
   * Strategies will render this appropriately (button for email, link for text).
   */
  action?: {
    label: string;
    url: string;
  };
  /**
   * Source type identifier for filtering and templates.
   * Examples: "password-reset", "healthcheck.alert", "maintenance.reminder"
   */
  type: string;
}

/**
 * Result of sending a notification.
 */
export interface NotificationDeliveryResult {
  /** Whether the notification was sent successfully */
  success: boolean;
  /** Strategy-specific external message ID for tracking */
  externalId?: string;
  /** Error message if send failed */
  error?: string;
  /** For rate limiting or retry logic (milliseconds) */
  retryAfterMs?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Send Context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Context passed to the strategy's send() method.
 */
export interface NotificationSendContext<
  TConfig,
  TUserConfig = undefined,
  TLayoutConfig = undefined
> {
  /** Full user identity from auth system */
  user: {
    userId: string;
    email?: string;
    displayName?: string;
  };
  /** Resolved contact for this channel (email, phone, slack user ID, etc.) */
  contact: string;
  /** The notification content to send */
  notification: NotificationPayload;
  /** Admin-configured strategy settings (global) */
  strategyConfig: TConfig;
  /** User-specific settings (if userConfig schema is defined) */
  userConfig: TUserConfig | undefined;
  /** Admin-configured layout settings (if strategy defines layoutConfig) */
  layoutConfig: TLayoutConfig | undefined;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OAuth Configuration for Strategies
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * OAuth 2.0 configuration for notification strategies.
 *
 * When a strategy provides this configuration, the notification-backend
 * registry automatically registers HTTP endpoints for the OAuth flow:
 * - GET /api/notification/oauth/{qualifiedId}/auth
 * - GET /api/notification/oauth/{qualifiedId}/callback
 * - POST /api/notification/oauth/{qualifiedId}/refresh
 * - DELETE /api/notification/oauth/{qualifiedId}/unlink
 */
export interface StrategyOAuthConfig {
  /**
   * OAuth 2.0 client ID.
   * Can be a function for lazy loading from ConfigService.
   */
  clientId: string | (() => string | Promise<string>);

  /**
   * OAuth 2.0 client secret.
   * Can be a function for lazy loading from ConfigService.
   */
  clientSecret: string | (() => string | Promise<string>);

  /**
   * Scopes to request from the OAuth provider.
   */
  scopes: string[];

  /**
   * Provider's authorization URL (where users are redirected to consent).
   * @example "https://slack.com/oauth/v2/authorize"
   */
  authorizationUrl: string;

  /**
   * Provider's token exchange URL.
   * @example "https://slack.com/api/oauth.v2.access"
   */
  tokenUrl: string;

  /**
   * Extract the user's external ID from the token response.
   * This ID is used to identify the user on the external platform.
   *
   * @example (response) => (response.authed_user as { id: string }).id // Slack
   */
  extractExternalId: (tokenResponse: Record<string, unknown>) => string;

  /**
   * Optional: Extract access token from response.
   * Default: response.access_token
   */
  extractAccessToken?: (response: Record<string, unknown>) => string;

  /**
   * Optional: Extract refresh token from response.
   * Default: response.refresh_token
   */
  extractRefreshToken?: (
    response: Record<string, unknown>
  ) => string | undefined;

  /**
   * Optional: Extract token expiration (seconds from now).
   * Default: response.expires_in
   */
  extractExpiresIn?: (response: Record<string, unknown>) => number | undefined;

  /**
   * Optional: Custom state encoder for CSRF protection.
   * Default implementation encodes userId and returnUrl as base64 JSON.
   */
  encodeState?: (userId: string, returnUrl: string) => string;

  /**
   * Optional: Custom state decoder.
   * Must match the encoder implementation.
   */
  decodeState?: (state: string) => { userId: string; returnUrl: string };

  /**
   * Optional: Custom authorization URL builder.
   * Use when provider has non-standard OAuth parameters.
   */
  buildAuthUrl?: (params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
  }) => string;

  /**
   * Optional: Custom token refresh logic.
   * Only needed if the provider uses refresh tokens.
   */
  refreshToken?: (refreshToken: string) => Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Notification Strategy Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Represents a notification delivery strategy (e.g., SMTP, Slack, Discord).
 *
 * Strategies are registered via the `notificationStrategyExtensionPoint` and
 * are namespaced by their owning plugin's ID to prevent conflicts.
 *
 * @example
 * ```typescript
 * const smtpStrategy: NotificationStrategy<SmtpConfig> = {
 *   id: 'smtp',
 *   displayName: 'Email (SMTP)',
 *   icon: 'mail',
 *   config: new Versioned({ version: 1, schema: smtpConfigSchema }),
 *   contactResolution: { type: 'auth-email' },
 *   async send({ contact, notification, strategyConfig }) {
 *     await sendEmail({ to: contact, subject: notification.title, ... });
 *     return { success: true };
 *   }
 * };
 * ```
 */
export interface NotificationStrategy<
  TConfig = unknown,
  TUserConfig = undefined,
  TLayoutConfig = undefined
> {
  /**
   * Unique identifier within the owning plugin's namespace.
   * Will be qualified as `{pluginId}.{id}` at runtime.
   * Example: 'smtp' becomes 'notification-smtp.smtp'
   */
  id: string;

  /** Display name shown in UI */
  displayName: string;

  /** Optional description of the channel */
  description?: string;

  /** Lucide icon name in PascalCase (e.g., 'Mail', 'MessageCircle') */
  icon?: LucideIconName;

  /**
   * Global strategy configuration (admin-managed).
   * Uses Versioned<T> for schema evolution and migration support.
   */
  config: Versioned<TConfig>;

  /**
   * Per-user configuration schema (if users need to provide info).
   *
   * Examples:
   * - SMTP: undefined (uses auth email, no user config needed)
   * - SMS: new Versioned({ schema: z.object({ phoneNumber: z.string() }) })
   * - Slack: undefined (uses OAuth linking)
   */
  userConfig?: Versioned<TUserConfig>;

  /**
   * Layout configuration for admin customization (optional).
   *
   * Only applicable for strategies that support rich layouts (e.g., email).
   * If defined, admins can customize branding (logo, colors, footer) via
   * the settings UI and the layout is passed to send() as `layoutConfig`.
   *
   * @example
   * ```typescript
   * layoutConfig: new Versioned({
   *   version: 1,
   *   schema: z.object({
   *     logoUrl: z.string().url().optional(),
   *     primaryColor: z.string().default("#3b82f6"),
   *     footerText: z.string().default("Sent by Checkmate"),
   *   }),
   * })
   * ```
   */
  layoutConfig?: Versioned<TLayoutConfig>;

  /**
   * How this strategy resolves user contact information.
   */
  contactResolution: NotificationContactResolution;

  /**
   * Send a notification via this channel.
   *
   * @param context - Send context with user, contact, notification, and config
   * @returns Result indicating success/failure
   */
  send(
    context: NotificationSendContext<TConfig, TUserConfig, TLayoutConfig>
  ): Promise<NotificationDeliveryResult>;

  /**
   * OAuth configuration for strategies that use OAuth linking.
   *
   * When provided, the notification-backend registry automatically registers
   * HTTP handlers for the OAuth flow. No manual endpoint registration needed.
   *
   * Required when contactResolution is { type: 'oauth-link' }.
   *
   * @example
   * ```typescript
   * oauth: {
   *   clientId: () => configService.get('slack.clientId'),
   *   clientSecret: () => configService.get('slack.clientSecret'),
   *   scopes: ['users:read', 'chat:write'],
   *   authorizationUrl: 'https://slack.com/oauth/v2/authorize',
   *   tokenUrl: 'https://slack.com/api/oauth.v2.access',
   *   extractExternalId: (res) => (res.authed_user as { id: string }).id,
   * }
   * ```
   */
  oauth?: StrategyOAuthConfig;

  /**
   * Markdown instructions shown when admins configure platform-wide strategy settings.
   * Displayed in the StrategyConfigCard before the configuration form.
   *
   * Use this to provide setup guidance (e.g., how to create API keys, register apps).
   *
   * @example
   * ```typescript
   * adminInstructions: `
   * ## Setup a Telegram Bot
   * 1. Open [@BotFather](https://t.me/BotFather) in Telegram
   * 2. Send \`/newbot\` and follow the prompts
   * 3. Copy the bot token
   * `
   * ```
   */
  adminInstructions?: string;

  /**
   * Markdown instructions shown when users configure their personal settings.
   * Displayed in the UserChannelCard when connecting/configuring.
   *
   * Use this to guide users through linking their account or setting up the channel.
   */
  userInstructions?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registry Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Registered strategy with full namespace information.
 */
export interface RegisteredNotificationStrategy<
  TConfig = unknown,
  TUserConfig = undefined,
  TLayoutConfig = undefined
> extends NotificationStrategy<TConfig, TUserConfig, TLayoutConfig> {
  /** Fully qualified ID: `{pluginId}.{id}` */
  qualifiedId: string;
  /** Plugin that registered this strategy */
  ownerPluginId: string;
  /**
   * Dynamically generated permission ID for this strategy.
   * Format: `{ownerPluginId}.strategy.{id}.use`
   */
  permissionId: string;
}

/**
 * Registry for notification strategies.
 * Maintained by notification-backend.
 */
export interface NotificationStrategyRegistry {
  /**
   * Register a notification strategy.
   * Must be called during plugin initialization.
   *
   * @param strategy - The strategy to register
   * @param pluginMetadata - Plugin metadata for namespacing
   */
  register(
    strategy: NotificationStrategy<unknown, unknown, unknown>,
    pluginMetadata: PluginMetadata
  ): void;

  /**
   * Get a strategy by its qualified ID.
   *
   * @param qualifiedId - Full ID in format `{pluginId}.{strategyId}`
   */
  getStrategy(
    qualifiedId: string
  ): RegisteredNotificationStrategy<unknown, unknown, unknown> | undefined;

  /**
   * Get all registered strategies.
   */
  getStrategies(): RegisteredNotificationStrategy<unknown, unknown, unknown>[];

  /**
   * Get all strategies that a user has permission to use.
   *
   * @param userPermissions - Set of permission IDs the user has
   */
  getStrategiesForUser(
    userPermissions: Set<string>
  ): RegisteredNotificationStrategy<unknown, unknown, unknown>[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Preference Types (for typings, actual storage in notification-backend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * User's notification preference for a specific strategy.
 */
export interface UserNotificationPreference {
  /** User ID */
  userId: string;
  /** Qualified strategy ID */
  strategyId: string;
  /** User's strategy-specific config (validated via strategy.userConfig) */
  config: VersionedRecord<unknown> | null;
  /** Whether user has enabled this channel */
  enabled: boolean;
  /** External user ID from OAuth linking (e.g., Slack user ID) */
  externalId: string | null;
  /** When the external account was linked */
  linkedAt: Date | null;
}
