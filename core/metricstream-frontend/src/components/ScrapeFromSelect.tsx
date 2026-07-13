import { usePluginClient } from "@checkstack/frontend-api";
import { SatelliteApi } from "@checkstack/satellite-common";
import {
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@checkstack/ui";
import {
  buildScrapeFromOptions,
  toScrapeFromValue,
  fromScrapeFromValue,
  type ScrapeFromOption,
} from "../lib/scrape-from";

export interface ScrapeFromSelectProps {
  /** The bound satellite id, or `null` for the core. */
  value: string | null;
  onChange: (satelliteId: string | null) => void;
  disabled?: boolean;
}

/**
 * "Scrape from" selector: core (default) vs a specific satellite. Satellites
 * that have not advertised the "scrape" capability are listed but disabled with
 * a hint, so an operator sees the option and why it is unavailable. A binding to
 * a satellite that has since disappeared from the list (deleted, or the caller
 * cannot see it) is preserved as a synthetic option so editing never silently
 * drops it. Rendered only where the caller holds satellite read access.
 */
export function ScrapeFromSelect({
  value,
  onChange,
  disabled,
}: ScrapeFromSelectProps) {
  const client = usePluginClient(SatelliteApi);
  const { data, isLoading } = client.listSatellites.useQuery();

  const options = buildScrapeFromOptions(data?.satellites ?? []);

  // Keep a currently-bound satellite selectable even if it is not in the list
  // (deleted, or lost the scrape capability but is still assigned).
  if (value !== null && !options.some((o) => o.value === value)) {
    const synthetic: ScrapeFromOption = {
      value,
      label: "Currently bound satellite",
      disabled: false,
      hint: null,
      isCore: false,
    };
    options.push(synthetic);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="scrape-from">Scrape from</Label>
      <Select
        value={toScrapeFromValue(value)}
        onValueChange={(v) => onChange(fromScrapeFromValue(v))}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="scrape-from">
          <SelectValue
            placeholder={isLoading ? "Loading satellites..." : "Core"}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
              {o.hint ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  {" - "}
                  {o.hint}
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Scrape from a satellite inside the target&apos;s network zone to avoid
        opening firewall holes for the core.
      </p>
    </div>
  );
}
