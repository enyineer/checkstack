import type { ImpactType } from "@checkstack/dependency-common";

/**
 * Which side of an edge a neighbour sits on, relative to the system whose detail
 * page is being viewed.
 * - `depends-on`: the neighbour is UPSTREAM (this system depends on it), so the
 *   neighbour's failure propagates INTO this system.
 * - `depended-on-by`: the neighbour is DOWNSTREAM (it depends on this system),
 *   so THIS system's failure propagates OUT to the neighbour.
 */
export type DependencyDirection = "depends-on" | "depended-on-by";

/** Severity tone driving the impact chip's colour. */
export type ImpactTone = "critical" | "degraded" | "informational";

export interface DependencyImpactPresentation {
  /**
   * Short chip label, framed as an impact CLASSIFICATION of the edge - never a
   * live health status. Reads as "what this dependency does to the system",
   * distinct from the neighbour's own health dot.
   */
  label: string;
  /** Full, direction-aware consequence sentence for the chip's tooltip. */
  description: string;
  /** Severity tone. */
  tone: ImpactTone;
}

/**
 * Present a dependency edge's `impactType` as an impact descriptor rather than a
 * status. The label classifies the edge ("Critical impact") and the description
 * spells out the concrete, directional consequence using the two system names,
 * so it can never be misread as "this dependency is down/degraded right now".
 *
 * `upstream` is the system whose failure is the CAUSE; `downstream` is the one
 * that suffers the EFFECT. These flip with `direction`.
 */
export function presentDependencyImpact({
  impactType,
  direction,
  systemName,
  neighbourName,
}: {
  impactType: ImpactType;
  direction: DependencyDirection;
  systemName: string;
  neighbourName: string;
}): DependencyImpactPresentation {
  const upstream = direction === "depends-on" ? neighbourName : systemName;
  const downstream = direction === "depends-on" ? systemName : neighbourName;

  switch (impactType) {
    case "critical": {
      return {
        label: "Critical impact",
        tone: "critical",
        description: `Critical dependency. If ${upstream} goes down, ${downstream} is treated as down.`,
      };
    }
    case "degraded": {
      return {
        label: "Degrading impact",
        tone: "degraded",
        description: `If ${upstream} is affected, ${downstream} is treated as degraded.`,
      };
    }
    case "informational": {
      return {
        label: "Informational",
        tone: "informational",
        description: `Linked for context only. ${upstream}'s status does not affect ${downstream}.`,
      };
    }
  }
}
