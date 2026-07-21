import { pillToneStyles } from "@checkstack/ui";
import type { StatusTone } from "./secretsDisplay.logic";

/**
 * Per-tone class sets for status pills, dots, and left accent stripes, taken
 * from the shared `pillToneStyles` table rather than a private copy so the
 * secrets surfaces stay in step with the colorblind-safe status triad
 * (ok / warn / down / unknown).
 */
export const toneStyles: Pick<typeof pillToneStyles, StatusTone> = {
  ok: pillToneStyles.ok,
  warn: pillToneStyles.warn,
  down: pillToneStyles.down,
  unknown: pillToneStyles.unknown,
};
