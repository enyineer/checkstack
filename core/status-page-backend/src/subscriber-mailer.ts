import type { Logger, RpcClient } from "@checkstack/backend-api";
import { NotificationApi } from "@checkstack/notification-common";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Outbound email for anonymous status-page subscribers.
 *
 * Status-page subscribers are RAW email addresses (not auth accounts), so this
 * delivers through notification-backend's `sendRawEmail` primitive (which drives
 * every enabled EMAIL strategy, e.g. SMTP, straight to the address) rather than
 * `sendTransactional` (which resolves recipients from auth accounts by userId).
 * Every message carries a mandatory unsubscribe link.
 */
export interface SubscriberMailer {
  /** Deliver an email to a raw address. */
  sendRaw(args: {
    to: string;
    subject: string;
    /** Markdown body; the email strategy wraps it in the configured layout. */
    body: string;
    /** Mandatory unsubscribe URL appended to the message. */
    unsubscribeUrl: string;
  }): Promise<void>;
}

/**
 * Real mailer: sends via notification-backend's `sendRawEmail` using the trusted
 * service RPC client (so it bypasses the per-user auth-account resolution).
 * Never throws to the caller - a delivery failure is logged and swallowed so the
 * subscribe/verify flow keeps its constant-time behaviour.
 */
export function createNotificationSubscriberMailer({
  rpcClient,
  logger,
}: {
  rpcClient: RpcClient;
  logger: Logger;
}): SubscriberMailer {
  return {
    async sendRaw({ to, subject, body, unsubscribeUrl }) {
      try {
        await rpcClient.forPlugin(NotificationApi).sendRawEmail({
          to,
          subject,
          body,
          unsubscribeUrl,
        });
      } catch (error) {
        logger.warn("[status-page] subscriber email send failed", {
          subject,
          error: extractErrorMessage(error),
        });
      }
    },
  };
}

/** Build the public verification / unsubscribe URLs for a page's base origin. */
export function subscriberUrls({
  baseUrl,
  slug,
  verificationToken,
  unsubscribeToken,
}: {
  baseUrl: string;
  slug: string;
  verificationToken: string;
  unsubscribeToken: string;
}): { verifyUrl: string; unsubscribeUrl: string } {
  const base = baseUrl.replace(/\/$/, "");
  const view = `${base}/statuspage/view/${encodeURIComponent(slug)}`;
  return {
    verifyUrl: `${view}?verify=${encodeURIComponent(verificationToken)}`,
    unsubscribeUrl: `${view}?unsubscribe=${encodeURIComponent(unsubscribeToken)}`,
  };
}
