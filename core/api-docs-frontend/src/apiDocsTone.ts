import type { AccessTone } from "./apiDocsStatus.logic";

/**
 * Per-tone class sets for the access status pill, its dot, the matching icon
 * color, and the endpoint card's left accent stripe. Spelled out as full
 * literal strings (not interpolated) so Tailwind's JIT keeps them, driven by
 * the colorblind-safe status triad.
 */
export const accessToneStyles: Record<
  AccessTone,
  { pill: string; dot: string; accent: string; icon: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
    icon: "text-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
    icon: "text-status-warn",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
    icon: "text-status-unknown",
  },
};
