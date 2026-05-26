import type { Logger } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Outcome of a [[postJson]] call. Discriminated on `ok`:
 * - `ok: true` carries the raw `Response` so callers can read service-specific
 *   success payloads (e.g. Pushover's `receipt`).
 * - `ok: false` carries a human-readable error string already suitable for
 *   surfacing back to operators via `NotificationDeliveryResult.error`.
 */
export type PostJsonResult =
  | { ok: true; response: Response }
  | { ok: false; error: string };

export interface PostJsonOptions {
  /** Absolute URL to POST to. */
  url: string;
  /** Body, JSON-stringified for you. */
  body: unknown;
  /**
   * Headers merged on top of `Content-Type: application/json`. Provide auth
   * tokens here (e.g. `Bearer ...`).
   */
  headers?: Record<string, string>;
  /** Request timeout. Defaults to 10s, matching the platform-wide default. */
  timeoutMs?: number;
  /**
   * Short, human-readable service label used to build log messages and the
   * returned error string. Example: `"Discord"`, `"Slack webhook"`.
   */
  serviceName: string;
  logger: Logger;
}

/**
 * Shared POST helper for notification strategies. Centralises the
 * timeout-bounded fetch, non-2xx logging, and error mapping that every
 * webhook-style notification plugin (Discord, Slack, Teams, Webex, Telegram,
 * Gotify, Pushover, ...) was previously re-implementing inline.
 *
 * Plugins remain responsible for building the request body and interpreting
 * a successful `Response` (some services return JSON receipts; most return
 * 204 No Content).
 */
export async function postJson(
  options: PostJsonOptions,
): Promise<PostJsonResult> {
  const {
    url,
    body,
    headers = {},
    timeoutMs = 10_000,
    serviceName,
    logger,
  } = options;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Failed to send ${serviceName} message`, {
        status: response.status,
        error: errorText.slice(0, 500),
      });
      return {
        ok: false,
        error: `Failed to send ${serviceName} message: ${response.status}`,
      };
    }

    return { ok: true, response };
  } catch (error) {
    const message = extractErrorMessage(error, `Unknown ${serviceName} error`);
    logger.error(`${serviceName} request error`, { error: message });
    return {
      ok: false,
      error: `Failed to send ${serviceName} notification: ${message}`,
    };
  }
}
