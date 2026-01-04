/**
 * Email layout utilities for notification strategies.
 *
 * Provides a responsive HTML email template that strategies can use
 * to wrap their content with consistent branding.
 *
 * @module
 */

/**
 * Options for the email layout wrapper.
 */
export interface EmailLayoutOptions {
  /** Email subject/title */
  title: string;
  /** Already-converted HTML body content */
  bodyHtml: string;
  /** Importance level affects header/button colors */
  importance: "info" | "warning" | "critical";
  /** Optional call-to-action button */
  action?: {
    label: string;
    url: string;
  };

  // Admin-customizable options (via layoutConfig)
  /** Logo URL (max ~200px wide recommended) */
  logoUrl?: string;
  /** Primary brand color (hex, e.g., "#3b82f6") */
  primaryColor?: string;
  /** Accent color for secondary elements */
  accentColor?: string;
  /** Footer text */
  footerText?: string;
  /** Footer links (e.g., Privacy Policy, Unsubscribe) */
  footerLinks?: Array<{ label: string; url: string }>;
}

// Default importance-based colors
const IMPORTANCE_COLORS = {
  info: "#3b82f6", // blue
  warning: "#f59e0b", // amber
  critical: "#ef4444", // red
} as const;

/**
 * Simple HTML escaping for security.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Wrap HTML content in a responsive email template.
 *
 * This template is designed to render consistently across major
 * email clients (Gmail, Outlook, Apple Mail, etc.).
 *
 * @example
 * ```typescript
 * const html = wrapInEmailLayout({
 *   title: "Password Reset",
 *   bodyHtml: "<p>Click the button below to reset your password.</p>",
 *   importance: "warning",
 *   action: { label: "Reset Password", url: "https://..." },
 *   primaryColor: "#10b981",
 *   footerText: "Sent by Acme Corp",
 * });
 * ```
 */
export function wrapInEmailLayout(options: EmailLayoutOptions): string {
  const {
    title,
    bodyHtml,
    importance,
    action,
    logoUrl,
    primaryColor,
    footerText = "This is an automated notification.",
    footerLinks = [],
  } = options;

  // Use custom color or importance-based default
  const headerColor = primaryColor ?? IMPORTANCE_COLORS[importance];
  const buttonColor = options.accentColor ?? headerColor;

  // Build footer links HTML
  const footerLinksHtml =
    footerLinks.length > 0
      ? footerLinks
          .map(
            (link) =>
              `<a href="${escapeHtml(
                link.url
              )}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(
                link.label
              )}</a>`
          )
          .join(" · ")
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset styles */
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f4f4f5;
    }
    /* Link styling */
    a {
      color: ${buttonColor};
    }
    /* Button styling */
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: ${buttonColor};
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      line-height: 1.5;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <!-- Main container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          ${
            logoUrl
              ? `
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 24px 24px 0 24px;">
              <img src="${escapeHtml(
                logoUrl
              )}" alt="Logo" style="max-width: 200px; height: auto;">
            </td>
          </tr>
          `
              : ""
          }
          <!-- Header -->
          <tr>
            <td style="background-color: ${headerColor}; padding: 20px 24px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; line-height: 1.4;">
                ${escapeHtml(title)}
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 24px;">
              <div style="color: #374151; font-size: 16px; line-height: 1.6;">
                ${bodyHtml}
              </div>
              ${
                action
                  ? `
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                <tr>
                  <td>
                    <a href="${escapeHtml(
                      action.url
                    )}" class="button" style="display: inline-block; padding: 12px 24px; background-color: ${buttonColor}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
                      ${escapeHtml(action.label)}
                    </a>
                  </td>
                </tr>
              </table>
              `
                  : ""
              }
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 24px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.5; text-align: center;">
                ${escapeHtml(footerText)}
              </p>
              ${
                footerLinksHtml
                  ? `
              <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 12px; line-height: 1.5; text-align: center;">
                ${footerLinksHtml}
              </p>
              `
                  : ""
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
