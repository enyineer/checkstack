import type { SatelliteWithStatus } from "@checkstack/satellite-common";
import { TELEMETRY_PULL_CAPABILITY_KIND } from "@checkstack/telemetry-common";

/**
 * "Run from satellite" selector logic for a pull source: the core (this
 * Checkstack server, the default) vs a specific satellite that executes the
 * pull from inside its own network zone. Mirrors metricstream's scrape-from
 * logic, filtering on the telemetry-pull capability instead of "scrape". Kept
 * pure so the option list, capability filtering and the persisted `satelliteId`
 * mapping are unit-testable without React.
 */

/** The capability a satellite must advertise to execute telemetry pulls. */
export const TELEMETRY_PULL_CAPABILITY = TELEMETRY_PULL_CAPABILITY_KIND;

/**
 * The Select value that means "run on the core". Radix Select cannot use an
 * empty-string item value, so `null` (core) maps to this sentinel and back.
 */
export const CORE_SATELLITE_VALUE = "__core__";

/** Copy shown under a satellite that cannot run telemetry pulls. */
export const TELEMETRY_PULL_DISABLED_HINT =
  "This satellite has not enabled telemetry pulls";

export interface RunFromOption {
  /** The Select item value: a satellite id, or `CORE_SATELLITE_VALUE`. */
  value: string;
  /** Display label. */
  label: string;
  /** True when this option cannot be selected (satellite lacks the capability). */
  disabled: boolean;
  /** Reason shown for a disabled option, else `null`. */
  hint: string | null;
  /** True for the synthetic "Core" option. */
  isCore: boolean;
}

/**
 * Build the option list: the core option first (always selectable), then every
 * satellite. Telemetry-pull-capable satellites are selectable; the rest are
 * disabled with a hint. Order otherwise follows the input satellite order.
 */
export function buildRunFromOptions(
  satellites: SatelliteWithStatus[],
): RunFromOption[] {
  const core: RunFromOption = {
    value: CORE_SATELLITE_VALUE,
    label: "Core (this server)",
    disabled: false,
    hint: null,
    isCore: true,
  };

  const satelliteOptions = satellites.map((sat): RunFromOption => {
    const canPull = sat.capabilities.includes(TELEMETRY_PULL_CAPABILITY);
    return {
      value: sat.id,
      label: sat.name,
      disabled: !canPull,
      hint: canPull ? null : TELEMETRY_PULL_DISABLED_HINT,
      isCore: false,
    };
  });

  return [core, ...satelliteOptions];
}

/** Map the persisted `satelliteId` (null = core) to a Select value. */
export function toRunFromValue(satelliteId: string | null): string {
  return satelliteId ?? CORE_SATELLITE_VALUE;
}

/** Map a Select value back to the persisted `satelliteId` (null = core). */
export function fromRunFromValue(value: string): string | null {
  return value === CORE_SATELLITE_VALUE ? null : value;
}
