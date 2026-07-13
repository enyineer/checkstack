import type { SatelliteWithStatus } from "@checkstack/satellite-common";

/**
 * "Scrape from" selector logic for a scrape target: the core (this Checkstack
 * server, the default) vs a specific satellite that scrapes from inside its own
 * network zone. Kept pure so the option list, disabled-satellite filtering and
 * the persisted `satelliteId` mapping are unit-testable without React.
 *
 * A satellite may only scrape when it advertised the "scrape" capability; the
 * others are offered but disabled with a hint, so an operator sees them (and
 * why they cannot be picked) rather than a silently missing entry.
 */

/** The capability id a satellite must advertise to be a scrape source. */
export const SCRAPE_CAPABILITY = "scrape";

/**
 * The Select value that means "scrape from the core". Radix Select cannot use
 * an empty-string item value, so `null` (core) maps to this sentinel and back.
 */
export const CORE_SCRAPE_VALUE = "__core__";

/** Copy shown under a scrape-incapable satellite option. */
export const SCRAPE_DISABLED_HINT =
  "This satellite has not enabled scraping";

export interface ScrapeFromOption {
  /** The Select item value: a satellite id, or `CORE_SCRAPE_VALUE` for core. */
  value: string;
  /** Display label. */
  label: string;
  /** True when this option cannot be selected (satellite lacks "scrape"). */
  disabled: boolean;
  /** Reason shown for a disabled option, else `null`. */
  hint: string | null;
  /** True for the synthetic "Core" option. */
  isCore: boolean;
}

/**
 * Build the option list: the core option first (always selectable), then every
 * satellite. Scrape-capable satellites are selectable; the rest are disabled
 * with a hint. Order otherwise follows the input satellite order.
 */
export function buildScrapeFromOptions(
  satellites: SatelliteWithStatus[],
): ScrapeFromOption[] {
  const core: ScrapeFromOption = {
    value: CORE_SCRAPE_VALUE,
    label: "Core (this server)",
    disabled: false,
    hint: null,
    isCore: true,
  };

  const satelliteOptions = satellites.map((sat): ScrapeFromOption => {
    const canScrape = sat.capabilities.includes(SCRAPE_CAPABILITY);
    return {
      value: sat.id,
      label: sat.name,
      disabled: !canScrape,
      hint: canScrape ? null : SCRAPE_DISABLED_HINT,
      isCore: false,
    };
  });

  return [core, ...satelliteOptions];
}

/** Map the persisted `satelliteId` (null = core) to a Select value. */
export function toScrapeFromValue(satelliteId: string | null): string {
  return satelliteId ?? CORE_SCRAPE_VALUE;
}

/** Map a Select value back to the persisted `satelliteId` (null = core). */
export function fromScrapeFromValue(value: string): string | null {
  return value === CORE_SCRAPE_VALUE ? null : value;
}

export interface ScrapeSourceBadge {
  /** Short label: "Core" or the satellite's name. */
  label: string;
  /** True when scraped by a satellite (drives badge tone/icon). */
  isSatellite: boolean;
  /**
   * True when the target is bound to a satellite id that is not in the current
   * satellite list (deleted or not yet loaded) - render a neutral fallback.
   */
  isUnknownSatellite: boolean;
}

/**
 * Resolve the "who scrapes this" badge for a target row from its persisted
 * `satelliteId` and the known satellite list. `null` => Core; a known id =>
 * that satellite's name; an unresolvable id => a neutral "Satellite" fallback
 * so a row never breaks when a bound satellite was deleted.
 */
export function resolveScrapeSourceBadge({
  satelliteId,
  satellites,
}: {
  satelliteId: string | null;
  satellites: SatelliteWithStatus[];
}): ScrapeSourceBadge {
  if (satelliteId === null) {
    return { label: "Core", isSatellite: false, isUnknownSatellite: false };
  }
  const match = satellites.find((s) => s.id === satelliteId);
  return {
    label: match ? match.name : "Satellite",
    isSatellite: true,
    isUnknownSatellite: !match,
  };
}
