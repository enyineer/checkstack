/**
 * Email layout utilities for notification strategies.
 *
 * Provides a responsive HTML email template that strategies can use
 * to wrap their content with consistent branding.
 *
 * @module
 */

/**
 * A notification subject as rendered by the email layout. Mirrors
 * `NotificationSubject` from `@checkstack/notification-common`.
 */
export interface EmailLayoutSubject {
  kind: string;
  id: string;
  name: string;
  url?: string;
  status?: "healthy" | "unhealthy" | "degraded" | "unknown";
}

/**
 * Options for the email layout wrapper.
 */
export interface EmailLayoutOptions {
  /** Email subject/title */
  title: string;
  /** Already-converted HTML body content */
  bodyHtml: string;
  /** Importance level affects the category badge color */
  importance: "info" | "warning" | "critical";
  /** Optional call-to-action button */
  action?: {
    label: string;
    url: string;
  };
  /**
   * Affected entities. Rendered as a card under the body, with each subject
   * as a clickable row when `url` is present. When `action` is omitted, the
   * subjects are the recipient's only navigation.
   */
  subjects?: EmailLayoutSubject[];

  // Admin-customizable options (via layoutConfig)
  /** Logo URL (max ~200px wide recommended). Rendered in the dark header. */
  logoUrl?: string;
  /** Primary brand color (hex, e.g., "#7c3aed"). Used for the CTA button. */
  primaryColor?: string;
  /** Accent color (overrides primary for the CTA button if provided). */
  accentColor?: string;
  /** Footer text */
  footerText?: string;
  /** Footer links (e.g., Privacy Policy, Unsubscribe) */
  footerLinks?: Array<{ label: string; url: string }>;
}

// Importance-based badge colors (rendered as monospace pills in the header)
const IMPORTANCE_BADGES = {
  info: { label: "INFO", bg: "#1e293b", fg: "#93c5fd" },
  warning: { label: "WARNING", bg: "#3a2a0e", fg: "#fbbf24" },
  critical: { label: "CRITICAL", bg: "#3a0e14", fg: "#fca5a5" },
} as const;

// Subject status dot colors. Status is optional on subjects; when absent,
// no dot is rendered.
const SUBJECT_STATUS_COLORS: Record<
  NonNullable<EmailLayoutSubject["status"]>,
  string
> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  unhealthy: "#ef4444",
  unknown: "#a1a1aa",
};

// Checkstack brand defaults — purple primary on near-black surfaces.
const BRAND_PRIMARY = "#8b5cf6"; // matches --primary in dark theme
const HEADER_BG = "#0a0a0c"; // matches --background in dark theme
const HEADER_BORDER = "#27272a"; // matches --border in dark theme
const HEADER_FG = "#fafafa";
const HEADER_MUTED = "#a1a1aa";

// Public marketing site the footer wordmark links to.
const CHECKSTACK_URL = "https://checkstack.dev";

/**
 * HTML escaping for security.
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
 * Render the footer text, escaping it for safety and then linking any
 * "Checkstack" wordmark to the public site. The injected anchor is a trusted
 * constant and the rest of the text stays escaped, so this cannot introduce
 * markup from an admin-customized footer string.
 */
export function renderFooterText(text: string): string {
  return escapeHtml(text).replaceAll(
    "Checkstack",
    `<a href="${CHECKSTACK_URL}" style="color: inherit; text-decoration: underline;">Checkstack</a>`,
  );
}

/**
 * Subtle grid pattern (matches the `ambient-grid` aesthetic in the app UI).
 * Embedded as an inline SVG data URI — supported in Apple Mail and most modern clients.
 * Email clients that strip backgrounds (Gmail web) gracefully fall back to the solid header color.
 */
const GRID_PATTERN_SVG =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHBhdGggZD0iTSA0OCAwIEwgMCAwIDAgNDgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzNmM2Y0NiIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjQiLz48L3N2Zz4=";

/**
 * Wrap HTML content in a Checkstack-branded responsive email template.
 *
 * The design pairs a dark "engineering" header (with optional grid pattern
 * and monospace importance badge) with a clean light body for readability,
 * and a purple-accented CTA button.
 *
 * @example
 * ```typescript
 * const html = wrapInEmailLayout({
 *   title: "Password Reset",
 *   bodyHtml: "<p>Click the button below to reset your password.</p>",
 *   importance: "info",
 *   action: { label: "Reset Password", url: "https://..." },
 *   primaryColor: "#7c3aed",
 *   footerText: "Sent by Checkstack",
 * });
 * ```
 */
export function wrapInEmailLayout(options: EmailLayoutOptions): string {
  const {
    title,
    bodyHtml,
    importance,
    action,
    subjects,
    logoUrl,
    primaryColor,
    footerText = "This is an automated notification from Checkstack.",
    footerLinks = [],
  } = options;

  const buttonColor = options.accentColor ?? primaryColor ?? BRAND_PRIMARY;
  const badge = IMPORTANCE_BADGES[importance];

  const subjectsHtml =
    subjects && subjects.length > 0
      ? `
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px; background-color: #fafafa; border: 1px solid #e4e4e7; border-radius: 8px;">
                <tr>
                  <td style="padding: 12px 16px;">
                    <p class="mono" style="margin: 0 0 8px 0; color: #71717a; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
                      Affected
                    </p>
                    ${subjects
                      .map((subject) => {
                        const statusDot = subject.status
                          ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${SUBJECT_STATUS_COLORS[subject.status]};margin-right:8px;vertical-align:middle;"></span>`
                          : "";
                        const namePart = `<span style="color:#18181b;font-size:14px;font-weight:500;vertical-align:middle;">${escapeHtml(subject.name)}</span>`;
                        const inner = subject.url
                          ? `<a href="${escapeHtml(subject.url)}" style="color:#18181b;text-decoration:none;">${statusDot}${namePart}</a>`
                          : `${statusDot}${namePart}`;
                        return `<div style="padding:6px 0;border-bottom:1px solid #e4e4e7;">${inner}</div>`;
                      })
                      .join("")}
                  </td>
                </tr>
              </table>
              `
      : "";

  const footerLinksHtml =
    footerLinks.length > 0
      ? footerLinks
          .map(
            (link) =>
              `<a href="${escapeHtml(link.url)}" style="color: #71717a; text-decoration: underline;">${escapeHtml(link.label)}</a>`,
          )
          .join(" · ")
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Force light scheme so clients don't auto-invert our intentionally dark header -->
  <meta name="color-scheme" content="only light">
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
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f4f4f5;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
    }
    a { color: ${buttonColor}; }
    /* Force-light-mode hardening: prevent Outlook/Apple Mail dark-mode auto-inversion. */
    [data-ogsc] .email-body, [data-ogsb] .email-body { color: #27272a !important; background-color: #ffffff !important; }
    [data-ogsc] .email-card, [data-ogsb] .email-card { background-color: #ffffff !important; }
    [data-ogsc] .email-footer, [data-ogsb] .email-footer { background-color: #fafafa !important; }
    [data-ogsc] .button-label, [data-ogsb] .button-label { color: #ffffff !important; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5;">
  <span style="display:none !important; visibility:hidden; mso-hide:all; font-size:1px; color:#f4f4f5; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">${escapeHtml(title)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Main container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="email-card" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04);">
          <!-- Header (dark, engineering aesthetic) -->
          <tr>
            <td style="background-color: ${HEADER_BG}; background-image: url('${GRID_PATTERN_SVG}'); background-repeat: repeat; background-size: 48px 48px; padding: 28px 28px 24px 28px; border-bottom: 1px solid ${HEADER_BORDER};">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    ${
                      logoUrl
                        ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" style="max-width: 160px; height: auto; display: block; margin-bottom: 14px;">`
                        : `<div class="mono" style="color: ${HEADER_MUTED}; font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 14px;">— checkstack</div>`
                    }
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 10px;">
                      <tr>
                        <td class="mono" style="background-color: ${badge.bg}; color: ${badge.fg}; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.12em;">
                          ${badge.label}
                        </td>
                      </tr>
                    </table>
                    <h1 style="margin: 0; color: ${HEADER_FG}; font-size: 22px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em;">
                      ${escapeHtml(title)}
                    </h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="email-body" bgcolor="#ffffff" style="padding: 28px 28px 24px 28px; background-color: #ffffff; color: #18181b;">
              <div style="color: #18181b; font-size: 15px; line-height: 1.65;">
                ${bodyHtml}
              </div>
              ${subjectsHtml}
              ${
                action
                  ? `
              <!-- CTA button: bulletproof Outlook VML fallback + standard anchor for everyone else -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                <tr>
                  <td bgcolor="${buttonColor}" style="background-color: ${buttonColor}; border-radius: 6px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(action.url)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="14%" stroke="f" fillcolor="${buttonColor}">
                      <w:anchorlock/>
                      <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;">${escapeHtml(action.label)}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapeHtml(action.url)}" class="button" style="display: inline-block; padding: 12px 22px; background-color: ${buttonColor}; border-radius: 6px; text-decoration: none; mso-hide: all;">
                      <span class="button-label" style="color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; font-weight: 600; line-height: 1.5; letter-spacing: 0.01em;">${escapeHtml(action.label)}</span>
                    </a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p class="mono" style="margin: 16px 0 0 0; color: #a1a1aa; font-size: 11px; line-height: 1.5; word-break: break-all;">
                ${escapeHtml(action.url)}
              </p>
              `
                  : ""
              }
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-footer" style="background-color: #fafafa; padding: 16px 28px; border-top: 1px solid #e4e4e7;">
              <p class="mono" style="margin: 0; color: #71717a; font-size: 11px; line-height: 1.5; text-align: center; letter-spacing: 0.02em;">
                ${renderFooterText(footerText)}
              </p>
              ${
                footerLinksHtml
                  ? `
              <p style="margin: 8px 0 0 0; color: #71717a; font-size: 11px; line-height: 1.5; text-align: center;">
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
