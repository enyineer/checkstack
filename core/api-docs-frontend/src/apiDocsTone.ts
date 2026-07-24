import { pillToneStyles } from "@checkstack/ui";
import type { AccessTone } from "./apiDocsStatus.logic";

/**
 * Per-tone class sets for the access status pill, its dot, the matching icon
 * color, and the endpoint card's left accent stripe. Sourced from the shared
 * `pillToneStyles` table rather than a private copy so the API browser cannot
 * drift from the rest of the design system; the icon color is the tone's
 * standalone foreground (`text`).
 */
export const accessToneStyles: Record<
  AccessTone,
  { pill: string; dot: string; accent: string; icon: string }
> = {
  ok: { ...pillToneStyles.ok, icon: pillToneStyles.ok.text },
  warn: { ...pillToneStyles.warn, icon: pillToneStyles.warn.text },
  unknown: { ...pillToneStyles.unknown, icon: pillToneStyles.unknown.text },
};
