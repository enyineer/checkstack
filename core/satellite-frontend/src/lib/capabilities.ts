/**
 * Satellite capability presentation: the agent advertises an opaque list of
 * capability ids (see the satellite protocol's `authenticate.capabilities`),
 * stored on the satellite row and surfaced here as human-readable badges. The
 * mapping is pure so it can be unit-tested and shared by the list, mobile card
 * and edit ("detail") surfaces without duplicating copy.
 */

export interface CapabilityMeta {
  /** The advertised capability id (matches the agent's env-driven flags). */
  id: string;
  /** Short badge label. */
  label: string;
  /** One-line explainer of what advertising this capability enables. */
  description: string;
}

/**
 * Known satellite capabilities, in canonical display order. Unknown ids (a
 * newer agent advertising something this UI predates) still render as a badge
 * using the raw id, so the surface degrades gracefully across version skew.
 */
export const KNOWN_SATELLITE_CAPABILITIES: readonly CapabilityMeta[] = [
  {
    id: "telemetry",
    label: "Telemetry",
    description:
      "Forwards logs and metrics from inside this satellite's network zone to the core over the satellite channel.",
  },
  {
    id: "telemetry-pull",
    label: "Telemetry pull",
    description:
      "Executes pull telemetry sources (Prometheus scrape, Kubernetes events) from inside this satellite's zone, so the core never opens a firewall hole to reach them.",
  },
  {
    id: "log-receivers",
    label: "Log receivers",
    description:
      "Runs local OTLP and native HTTP log receivers, so shippers in this zone send to the satellite instead of the core.",
  },
  {
    id: "trace-receivers",
    label: "Trace receivers",
    description:
      "Runs local OTLP and native HTTP trace receivers, so span exporters in this zone send to the satellite instead of the core.",
  },
  {
    id: "syslog",
    label: "Syslog",
    description:
      "Listens for RFC 5424 syslog on this satellite and forwards the parsed lines to the core.",
  },
];

const CAPABILITY_BY_ID = new Map(
  KNOWN_SATELLITE_CAPABILITIES.map((c) => [c.id, c]),
);

export interface CapabilityBadge {
  /** The advertised capability id. */
  id: string;
  /** Human label for a known capability, else the raw id. */
  label: string;
  /** Explainer for a known capability, or `null` for an unrecognised id. */
  description: string | null;
  /** True when the id is one this UI knows how to describe. */
  known: boolean;
}

/**
 * Map a satellite's advertised capability ids to ordered badge descriptors:
 * known capabilities first (in canonical order), then any unrecognised ids in
 * advertised order. Duplicate ids collapse to a single badge.
 */
export function toCapabilityBadges(capabilities: string[]): CapabilityBadge[] {
  const advertised = new Set(capabilities);

  const known: CapabilityBadge[] = KNOWN_SATELLITE_CAPABILITIES.filter((c) =>
    advertised.has(c.id),
  ).map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    known: true,
  }));

  const unknown: CapabilityBadge[] = [];
  const seenUnknown = new Set<string>();
  for (const id of capabilities) {
    if (CAPABILITY_BY_ID.has(id) || seenUnknown.has(id)) continue;
    seenUnknown.add(id);
    unknown.push({ id, label: id, description: null, known: false });
  }

  return [...known, ...unknown];
}

/** True when the satellite advertises the given capability id. */
export function hasCapability(
  capabilities: string[],
  capabilityId: string,
): boolean {
  return capabilities.includes(capabilityId);
}
