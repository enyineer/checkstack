import { lookup } from "node:dns/promises";
import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { AuthUser } from "@checkstack/backend-api";
import { aiAccess, pluginMetadata as aiPluginMetadata } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";
import {
  isPrivateIp,
  parseSafeProbeUrl,
  PROBE_MAX_BODY_BYTES,
  PROBE_TIMEOUT_MS,
} from "./ssrf-guard";

/** Input for `ai.probeUrl`: the URL to introspect and the HTTP method. */
export const ProbeUrlInputSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["GET", "HEAD"]).default("GET"),
});
export type ProbeUrlInput = z.infer<typeof ProbeUrlInputSchema>;

/** What a probe reports back to the model (no secrets, body capped). */
export const ProbeUrlOutputSchema = z.object({
  url: z.string(),
  status: z.number(),
  statusText: z.string(),
  /** True for a 3xx; `location` carries the redirect target (not followed). */
  redirected: z.boolean(),
  location: z.string().optional(),
  contentType: z.string().optional(),
  /** A safe, small subset of response headers. */
  headers: z.record(z.string(), z.string()),
  /** Up to PROBE_MAX_BODY_BYTES of the body, decoded as text. */
  bodySample: z.string(),
  bodyTruncated: z.boolean(),
});
export type ProbeUrlOutput = z.infer<typeof ProbeUrlOutputSchema>;

/** Response headers we surface (never set-cookie / auth-bearing headers). */
const SAFE_HEADERS = ["content-type", "content-length", "server", "location"];

/** Read up to PROBE_MAX_BODY_BYTES of a response body as text (capped). */
async function readCappedText(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = PROBE_MAX_BODY_BYTES - total;
    if (value.length >= remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

/**
 * `ai.probeUrl` - issue ONE outbound HTTP GET/HEAD so the assistant can see what
 * a URL actually returns (status, content type, a body sample) before drafting a
 * health check's assertions. `effect: "read"` (auto-runs).
 *
 * SSRF DEFENSE (the request leaves the CORE BACKEND): the URL shape is validated
 * (`parseSafeProbeUrl` - http(s) only, no loopback/internal host, no private IP
 * literal), the hostname is then DNS-resolved and EVERY resolved IP is checked
 * against the private/reserved ranges (catching a public name that resolves to a
 * private IP), redirects are NOT followed (a 3xx only reports its `location`),
 * the request carries no credentials, times out at PROBE_TIMEOUT_MS, and the body
 * is read capped at PROBE_MAX_BODY_BYTES.
 */
export function createProbeUrlTool(): RegisteredAiTool<
  ProbeUrlInput,
  ProbeUrlOutput
> {
  return {
    name: "probeUrl",
    description:
      "Make ONE outbound HTTP GET or HEAD request to a public URL and return its status code, content type, response headers, and a sample of the body. Use this to inspect what an endpoint returns (e.g. what GET https://foo.bar/status responds with) BEFORE drafting a health check's assertions, so you assert on the real response. Redirects are not followed (a 3xx returns its Location). Cannot reach private/internal addresses.",
    effect: "read",
    input: ProbeUrlInputSchema,
    output: ProbeUrlOutputSchema,
    // Same broad chat-read surface as the docs/capability read tools.
    requiredAccessRules: [qualifyAccessRuleId(aiPluginMetadata, aiAccess.chatUse)],
    async execute({ input }: { input: ProbeUrlInput; principal: AuthUser }) {
      const { url, hostname } = parseSafeProbeUrl(input.url);

      // DNS re-check: a public-looking hostname must not resolve to a private IP.
      const resolved = await lookup(hostname, { all: true });
      for (const { address } of resolved) {
        if (isPrivateIp(address)) {
          throw new Error(
            `Refusing to probe "${hostname}": it resolves to a private/reserved address (${address}).`,
          );
        }
      }

      const response = await fetch(url, {
        method: input.method,
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        // No credentials/cookies; advertise a benign accept.
        headers: { accept: "*/*" },
      });

      const headers: Record<string, string> = {};
      for (const name of SAFE_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = value;
      }

      const redirected = response.status >= 300 && response.status < 400;
      const { text, truncated } =
        input.method === "HEAD"
          ? { text: "", truncated: false }
          : await readCappedText(response);

      return {
        url: url.toString(),
        status: response.status,
        statusText: response.statusText,
        redirected,
        location: response.headers.get("location") ?? undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        headers,
        bodySample: text,
        bodyTruncated: truncated,
      };
    },
  };
}
