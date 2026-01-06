/**
 * OAuth Callback Handler
 *
 * Handles OAuth callback redirects from external providers.
 * Registered as HTTP handlers at `/api/notification/oauth/{strategyId}/callback`.
 */

import type {
  NotificationStrategyRegistry,
  ConfigService,
} from "@checkmate-monitor/backend-api";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createStrategyService } from "./strategy-service";
import type * as schema from "./schema";

export interface OAuthCallbackDeps {
  db: NodePgDatabase<typeof schema>;
  configService: ConfigService;
  strategyRegistry: NotificationStrategyRegistry;
  baseUrl: string;
}

/**
 * Create an OAuth callback handler that routes to the appropriate strategy.
 *
 * @param deps - Service dependencies
 * @returns HTTP handler function for OAuth callbacks
 */
export function createOAuthCallbackHandler(
  deps: OAuthCallbackDeps
): (req: Request) => Promise<Response> {
  const { db, configService, strategyRegistry, baseUrl } = deps;

  const strategyService = createStrategyService({
    db,
    configService,
    strategyRegistry,
  });

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Extract strategy ID from path: /oauth/{strategyId}/callback
    const pathParts = url.pathname.split("/");
    const oauthIndex = pathParts.indexOf("oauth");
    if (oauthIndex === -1 || pathParts.length <= oauthIndex + 2) {
      return new Response("Invalid OAuth path", { status: 400 });
    }

    const strategyId = pathParts[oauthIndex + 1];
    const action = pathParts[oauthIndex + 2]; // "callback" or other actions

    if (action !== "callback") {
      return new Response(`Unknown OAuth action: ${action}`, { status: 400 });
    }

    // Find strategy
    const strategy = strategyRegistry.getStrategy(strategyId);
    if (!strategy) {
      return new Response(`Strategy not found: ${strategyId}`, { status: 404 });
    }

    if (!strategy.oauth) {
      return new Response(`Strategy ${strategyId} does not support OAuth`, {
        status: 400,
      });
    }

    const oauth = strategy.oauth;

    // Get code and state from query params
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Handle error from provider
    if (error) {
      const errorDescription =
        url.searchParams.get("error_description") || error;
      return Response.redirect(
        `${baseUrl}/notification/settings?error=${encodeURIComponent(
          errorDescription
        )}`,
        302
      );
    }

    if (!code || !state) {
      return Response.redirect(
        `${baseUrl}/notification/settings?error=${encodeURIComponent(
          "Missing code or state parameter"
        )}`,
        302
      );
    }

    // Decode state
    let stateData: { userId: string; returnUrl: string };
    try {
      const decoded = atob(state);
      stateData = JSON.parse(decoded);
    } catch {
      return Response.redirect(
        `${baseUrl}/notification/settings?error=${encodeURIComponent(
          "Invalid state parameter"
        )}`,
        302
      );
    }

    const { userId, returnUrl } = stateData;
    const defaultReturnUrl = "/notification/settings";
    const finalReturnUrl = returnUrl || defaultReturnUrl;

    try {
      // Exchange code for tokens
      const callbackUrl = `${baseUrl}/api/notification/oauth/${strategyId}/callback`;

      // Resolve client ID and secret (may be functions)
      const clientIdVal = oauth.clientId;
      const clientSecretVal = oauth.clientSecret;
      const clientId =
        typeof clientIdVal === "function" ? await clientIdVal() : clientIdVal;
      const clientSecret =
        typeof clientSecretVal === "function"
          ? await clientSecretVal()
          : clientSecretVal;

      // Exchange authorization code for tokens
      const tokenResponse = await fetch(oauth.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`OAuth token exchange failed: ${errorText}`);
        return Response.redirect(
          `${baseUrl}${finalReturnUrl}?error=${encodeURIComponent(
            "Token exchange failed"
          )}`,
          302
        );
      }

      const tokens = (await tokenResponse.json()) as Record<string, unknown>;

      // Extract tokens using strategy's extractors or defaults
      const accessToken =
        oauth.extractAccessToken?.(tokens) || (tokens.access_token as string);
      const refreshToken =
        oauth.extractRefreshToken?.(tokens) ||
        (tokens.refresh_token as string | undefined);
      const expiresIn =
        oauth.extractExpiresIn?.(tokens) ||
        (typeof tokens.expires_in === "number" ? tokens.expires_in : undefined);

      // Extract external ID using strategy's extractor
      const externalId = oauth.extractExternalId(tokens);

      // Calculate expiration date
      const expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000)
        : undefined;

      // Store tokens via StrategyService
      await strategyService.storeOAuthTokens({
        userId,
        strategyId,
        externalId,
        accessToken,
        refreshToken,
        expiresAt,
      });

      // Redirect to return URL with success
      return Response.redirect(
        `${baseUrl}${finalReturnUrl}?linked=${strategyId}`,
        302
      );
    } catch (error_) {
      console.error("OAuth callback error:", error_);
      return Response.redirect(
        `${baseUrl}${finalReturnUrl}?error=${encodeURIComponent(
          "OAuth processing failed"
        )}`,
        302
      );
    }
  };
}
