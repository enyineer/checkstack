import { APICallError } from "ai";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Turn an error thrown by the model provider (or the agent loop) into a
 * USER-FACING message plus a STRUCTURED log detail. Pure + total: never throws.
 *
 * The AI SDK masks streaming errors by default (the UI gets a generic "An error
 * occurred"), which hid the provider's real HTTP response. We surface it
 * instead: an `APICallError` carries the provider's `statusCode` and
 * `responseBody`, which is exactly what an operator needs to forward to their
 * model provider when a turn fails (for example a 400 `invalid_prompt`).
 *
 * SECURITY: `responseBody` is the provider's ERROR payload, not our request, so
 * it never contains the integration credential. The request body (which carries
 * the api key in headers, never the body) is deliberately NOT echoed.
 */
export interface FormattedModelError {
  /** Shown in the chat UI in place of the SDK's masked generic error. */
  userMessage: string;
  /** Structured fields for the server log (never rendered verbatim to a user). */
  logDetail: Record<string, unknown>;
}

/** Cap the provider body we echo so a huge payload can't flood the UI or log. */
const MAX_LENGTH = 2000;

function truncate({ value }: { value: string }): string {
  return value.length > MAX_LENGTH
    ? `${value.slice(0, MAX_LENGTH)}... (truncated)`
    : value;
}

export function formatModelError({
  error,
}: {
  error: unknown;
}): FormattedModelError {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? "unknown";
    const body =
      typeof error.responseBody === "string" && error.responseBody.length > 0
        ? truncate({ value: error.responseBody })
        : error.message;
    return {
      userMessage: `The AI provider rejected the request (HTTP ${status}). ${body}`,
      logDetail: {
        kind: "APICallError",
        statusCode: error.statusCode,
        url: error.url,
        isRetryable: error.isRetryable,
        responseBody: error.responseBody,
        message: error.message,
      },
    };
  }

  // Any other error (agent-loop bug, network, unknown): surface its message via
  // the shared extractor (handles Error, string, and unknown shapes uniformly).
  const message = extractErrorMessage(error);
  return {
    userMessage: `The assistant hit an error: ${truncate({ value: message })}`,
    logDetail: { kind: "error", message },
  };
}
