import { z } from "zod";

/**
 * Platform-level configuration for the AI platform OAuth Authorization Server
 * and MCP server (Phase 2). Controls Dynamic Client Registration (DCR) and the
 * per-IP DCR rate-limit. Token, consent, and client state are owned by Better
 * Auth's OAuth Provider tables; this is only the operator-facing toggle.
 */
export const mcpOAuthConfigV1 = z.object({
  /**
   * Whether the OAuth Authorization Server + MCP server are enabled at all.
   * Off by default so the AS surface only exists once an operator opts in.
   */
  enabled: z
    .boolean()
    .default(false)
    .describe(
      "When enabled, Checkstack acts as an OAuth Authorization Server and serves the MCP endpoint.",
    ),
  /**
   * Whether Dynamic Client Registration (`POST /oauth2/register`) is open. When
   * false, MCP clients must be registered out-of-band by an admin.
   */
  allowDynamicClientRegistration: z
    .boolean()
    .default(false)
    .describe(
      "When enabled, MCP clients may self-register via Dynamic Client Registration.",
    ),
  /**
   * Max DCR registrations allowed per client IP within the fixed window.
   * Enforced by a shared-Postgres counter (never in-memory) so the cap holds
   * across all pods.
   */
  dcrRateLimitMax: z
    .number()
    .int()
    .positive()
    .default(5)
    .describe("Maximum DCR registrations per IP per window."),
  /** DCR rate-limit window length, in seconds. */
  dcrRateLimitWindowSeconds: z
    .number()
    .int()
    .positive()
    .default(3600)
    .describe("DCR rate-limit fixed-window length in seconds."),
});

export type McpOAuthConfig = z.infer<typeof mcpOAuthConfigV1>;

export const MCP_OAUTH_CONFIG_VERSION = 1;
export const MCP_OAUTH_CONFIG_ID = "ai.mcp-oauth";
