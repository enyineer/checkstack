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
  buildRunFromOptions,
  toRunFromValue,
  fromRunFromValue,
  type RunFromOption,
} from "../lib/satellite-source.logic";

export interface RunFromSatelliteSelectProps {
  /** The bound satellite id, or `null` for the core. */
  value: string | null;
  onChange: (satelliteId: string | null) => void;
  disabled?: boolean;
}

/**
 * "Run from" selector: core (default) vs a specific satellite that executes the
 * pull from inside its network zone. Satellites that have not advertised the
 * telemetry-pull capability are listed but disabled with a hint, so an operator
 * sees the option and why it is unavailable. A binding to a satellite that has
 * since disappeared from the list (deleted, or the caller cannot see it) is
 * preserved as a synthetic option so editing never silently drops it. Rendered
 * only where the caller holds satellite read access.
 */
export function RunFromSatelliteSelect({
  value,
  onChange,
  disabled,
}: RunFromSatelliteSelectProps) {
  const client = usePluginClient(SatelliteApi);
  const { data, isLoading } = client.listSatellites.useQuery();

  const options = buildRunFromOptions(data?.satellites ?? []);

  // Keep a currently-bound satellite selectable even if it is not in the list
  // (deleted, or lost the capability but is still assigned).
  if (value !== null && !options.some((o) => o.value === value)) {
    const synthetic: RunFromOption = {
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
      <Label htmlFor="source-run-from">Run from</Label>
      <Select
        value={toRunFromValue(value)}
        onValueChange={(v) => onChange(fromRunFromValue(v))}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="source-run-from">
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
        Run the pull from a satellite inside the target&apos;s network zone to
        avoid opening firewall holes for the core.
      </p>
    </div>
  );
}
