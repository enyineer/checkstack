/**
 * OAuth Handler Factory
 *
 * Provides a generic, reusable OAuth 2.0 handler for plugins that need OAuth flows.
 * Used by notification strategies but can be reused by any plugin.
 *
 * @module @checkmate-monitor/backend-api/oauth-handler
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OAuth Configuration Interface
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * OAuth 2.0 provider configuration.
 * Designed for declarative definition with minimal boilerplate.
 */
export interface OAuthConfig {
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
   * @example (response) => response.authed_user.id // Slack
   * @example (response) => response.user.id // Discord
   */
  extractExternalId: (tokenResponse: Record<string, unknown>) => string;

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
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Handler Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Token storage callback parameters.
 */
export interface OAuthTokenData {
  userId: string;
  externalId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * Configuration for creating an OAuth handler.
 */
export interface OAuthHandlerConfig {
  /** OAuth provider configuration */
  oauth: OAuthConfig;

  /** Unique identifier for this OAuth integration */
  qualifiedId: string;

  /** Base URL for constructing callback URLs */
  baseUrl: string;

  /** Default return URL after OAuth flow completes */
  defaultReturnUrl: string;

  /** Called when tokens are received from provider */
  onTokenReceived: (data: OAuthTokenData) => Promise<void>;

  /** Called when user unlinks their account */
  onUnlink: (userId: string) => Promise<void>;

  /** Get current user ID from the request (requires auth) */
  getUserIdFromRequest: (req: Request) => Promise<string | undefined>;

  /** Optional: Error page URL for displaying errors */
  errorUrl?: string;
}

/**
 * Result of creating an OAuth handler.
 */
export interface OAuthHandlerResult {
  /** The HTTP request handler */
  handler: (req: Request) => Promise<Response>;

  /** Generated endpoint paths */
  paths: {
    /** Start OAuth flow */
    auth: string;
    /** Handle provider callback */
    callback: string;
    /** Refresh expired token */
    refresh: string;
    /** Unlink account */
    unlink: string;
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Default Implementations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function defaultEncodeState(userId: string, returnUrl: string): string {
  const data = JSON.stringify({ userId, returnUrl, ts: Date.now() });
  return btoa(data);
}

function defaultDecodeState(state: string): {
  userId: string;
  returnUrl: string;
} {
  try {
    const data = JSON.parse(atob(state));
    return { userId: data.userId, returnUrl: data.returnUrl };
  } catch {
    throw new Error("Invalid OAuth state");
  }
}

function defaultBuildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  authorizationUrl: string;
}): string {
  const url = new URL(params.authorizationUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function resolveValue(
  value: string | (() => string | Promise<string>)
): Promise<string> {
  return typeof value === "function" ? await value() : value;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OAuth Handler Factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Creates a reusable OAuth 2.0 handler for a given configuration.
 *
 * @example
 * ```typescript
 * const { handler, paths } = createOAuthHandler({
 *   oauth: {
 *     clientId: () => config.slackClientId,
 *     clientSecret: () => config.slackClientSecret,
 *     scopes: ["users:read", "chat:write"],
 *     authorizationUrl: "https://slack.com/oauth/v2/authorize",
 *     tokenUrl: "https://slack.com/api/oauth.v2.access",
 *     extractExternalId: (res) => res.authed_user.id,
 *   },
 *   qualifiedId: "notification-slack.slack",
 *   baseUrl: "https://myapp.com",
 *   defaultReturnUrl: "/notification/settings",
 *   onTokenReceived: (data) => storeToken(data),
 *   onUnlink: (userId) => clearToken(userId),
 *   getUserIdFromRequest: (req) => authService.getUserId(req),
 * });
 *
 * // Register: rpc.registerHttpHandler(handler, `/oauth/${qualifiedId}`);
 * ```
 */
export function createOAuthHandler(
  config: OAuthHandlerConfig
): OAuthHandlerResult {
  const { oauth, qualifiedId, baseUrl, defaultReturnUrl } = config;

  const encodeState = oauth.encodeState ?? defaultEncodeState;
  const decodeState = oauth.decodeState ?? defaultDecodeState;

  const basePath = `/oauth/${qualifiedId}`;
  const paths = {
    auth: `${basePath}/auth`,
    callback: `${basePath}/callback`,
    refresh: `${basePath}/refresh`,
    unlink: `${basePath}/unlink`,
  };

  const callbackUrl = `${baseUrl}/api/notification${paths.callback}`;

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // ─────────────────────────────────────────────────────────────────────────
    // GET /auth - Start OAuth flow
    // ─────────────────────────────────────────────────────────────────────────
    if (pathname.endsWith("/auth") && req.method === "GET") {
      const userId = await config.getUserIdFromRequest(req);
      if (!userId) {
        return new Response("Unauthorized", { status: 401 });
      }

      const returnUrl = url.searchParams.get("returnUrl") ?? defaultReturnUrl;
      const state = encodeState(userId, returnUrl);

      const clientId = await resolveValue(oauth.clientId);

      const authUrl = oauth.buildAuthUrl
        ? oauth.buildAuthUrl({
            clientId,
            redirectUri: callbackUrl,
            scopes: oauth.scopes,
            state,
          })
        : defaultBuildAuthUrl({
            clientId,
            redirectUri: callbackUrl,
            scopes: oauth.scopes,
            state,
            authorizationUrl: oauth.authorizationUrl,
          });

      return Response.redirect(authUrl, 302);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /callback - Handle provider callback
    // ─────────────────────────────────────────────────────────────────────────
    if (pathname.endsWith("/callback") && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        const errorUrl = config.errorUrl ?? defaultReturnUrl;
        return Response.redirect(
          `${errorUrl}?error=${encodeURIComponent(error)}`,
          302
        );
      }

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      let stateData: { userId: string; returnUrl: string };
      try {
        stateData = decodeState(state);
      } catch {
        return new Response("Invalid state", { status: 400 });
      }

      // Exchange code for tokens
      const clientId = await resolveValue(oauth.clientId);
      const clientSecret = await resolveValue(oauth.clientSecret);

      const tokenResponse = await fetch(oauth.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("OAuth token exchange failed:", errorText);
        return Response.redirect(
          `${stateData.returnUrl}?error=token_exchange_failed`,
          302
        );
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>;

      // Extract token data
      const extractAccessToken =
        oauth.extractAccessToken ??
        ((r: Record<string, unknown>) => r.access_token as string);
      const extractRefreshToken =
        oauth.extractRefreshToken ??
        ((r: Record<string, unknown>) => r.refresh_token as string | undefined);
      const extractExpiresIn =
        oauth.extractExpiresIn ??
        ((r: Record<string, unknown>) => r.expires_in as number | undefined);

      const accessToken = extractAccessToken(tokenData);
      const refreshToken = extractRefreshToken(tokenData);
      const expiresIn = extractExpiresIn(tokenData);
      const externalId = oauth.extractExternalId(tokenData);

      const expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : undefined;

      // Store tokens
      await config.onTokenReceived({
        userId: stateData.userId,
        externalId,
        accessToken,
        refreshToken,
        expiresAt,
      });

      return Response.redirect(stateData.returnUrl, 302);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /refresh - Refresh expired token
    // ─────────────────────────────────────────────────────────────────────────
    if (pathname.endsWith("/refresh") && req.method === "POST") {
      const userId = await config.getUserIdFromRequest(req);
      if (!userId) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (!oauth.refreshToken) {
        return Response.json(
          { error: "Token refresh not supported" },
          { status: 501 }
        );
      }

      // Get refresh token from request body
      const body = (await req.json()) as { refreshToken?: string };
      if (!body.refreshToken) {
        return Response.json(
          { error: "Missing refreshToken" },
          { status: 400 }
        );
      }

      try {
        const result = await oauth.refreshToken(body.refreshToken);
        return Response.json(result);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Refresh failed" },
          { status: 500 }
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DELETE /unlink - Disconnect account
    // ─────────────────────────────────────────────────────────────────────────
    if (pathname.endsWith("/unlink") && req.method === "DELETE") {
      const userId = await config.getUserIdFromRequest(req);
      if (!userId) {
        return new Response("Unauthorized", { status: 401 });
      }

      await config.onUnlink(userId);
      return new Response(undefined, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }

  return { handler, paths };
}
