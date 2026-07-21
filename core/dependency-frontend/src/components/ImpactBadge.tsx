import React from "react";
import { StatusPill } from "@checkstack/ui";
import type { ImpactType } from "@checkstack/dependency-common";
import { impactTypeTone } from "./statusPill.logic";

/** Human label per impact type. */
const IMPACT_LABELS: Record<ImpactType, string> = {
  critical: "Critical",
  degraded: "Degraded",
  informational: "Info",
};

/**
 * A dependency's impact, on the shared status pill.
 *
 * Previously this was a `getImpactBadge` switch duplicated in BOTH the alert
 * banner and the editor, each hand-writing the pill's classes inline - so the
 * tone -> class mapping existed twice more than it needed to, next to a
 * `statusPill.logic` module that already owned exactly that mapping. The tone
 * now comes from that module and the chip from `@checkstack/ui`.
 */
export const ImpactBadge: React.FC<{ impactType: ImpactType }> = ({
  impactType,
}) => (
  <StatusPill tone={impactTypeTone({ impactType })}>
    {IMPACT_LABELS[impactType]}
  </StatusPill>
);
