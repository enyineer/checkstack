/**
 * Utilities for handling authentication error redirects
 * to the frontend error page with proper encoding.
 */

/**
 * Encode error message for URL (better-auth uses underscores for spaces)
 * @param message - The error message to encode
 * @returns The encoded message with spaces replaced by underscores
 */
export function encodeAuthError(message: string): string {
  return message.replaceAll(" ", "_");
}

/**
 * Build auth error redirect URL
 * @param errorMessage - User-friendly error message
 * @param frontendUrl - Frontend base URL (defaults to BASE_URL env var)
 * @returns The full redirect URL to the error page
 */
export function buildAuthErrorUrl(
  errorMessage: string,
  frontendUrl?: string
): string {
  const base = frontendUrl || process.env.BASE_URL;
  const encoded = encodeAuthError(errorMessage);
  return `${base}/auth/error?error=${encodeURIComponent(encoded)}`;
}

/**
 * Create HTTP redirect response to auth error page
 * @param errorMessage - User-friendly error message
 * @param frontendUrl - Optional frontend base URL
 * @returns HTTP redirect Response to the error page
 */
export function redirectToAuthError(
  errorMessage: string,
  frontendUrl?: string
): Response {
  return Response.redirect(buildAuthErrorUrl(errorMessage, frontendUrl), 302);
}
