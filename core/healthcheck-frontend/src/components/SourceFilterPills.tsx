import { Satellite, Server } from "lucide-react";

/** A satellite option offered by the source filter. */
export interface SourceFilterSatellite {
  id: string;
  name: string;
}

interface SourceFilterPillsProps {
  /** `undefined` = all sources, `"local"` = the core, else a satellite id. */
  value: string | undefined;
  /** Called with no argument to clear back to "All". */
  onChange: (next?: string) => void;
  satellites: SourceFilterSatellite[];
}

const BASE_PILL =
  "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors";
const IDLE_PILL = "bg-muted text-muted-foreground hover:bg-muted/80";

/**
 * Source filter for run-history surfaces: All / Local / one pill per
 * satellite. Satellites carry the status-warn signal hue (the same hue the
 * run tables use for remote-source chips) so "remote" reads consistently;
 * everything else stays on neutral tokens.
 */
export function SourceFilterPills({
  value,
  onChange,
  satellites,
}: SourceFilterPillsProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Source:</span>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onChange()}
          className={`${BASE_PILL} ${
            value === undefined
              ? "bg-primary text-primary-foreground"
              : IDLE_PILL
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => onChange("local")}
          className={`${BASE_PILL} ${
            value === "local" ? "bg-primary text-primary-foreground" : IDLE_PILL
          }`}
        >
          <Server className="h-3 w-3" />
          Local
        </button>
        {satellites.map((satellite) => (
          <button
            key={satellite.id}
            type="button"
            onClick={() => onChange(satellite.id)}
            className={`${BASE_PILL} ${
              value === satellite.id
                ? "bg-status-warn text-white"
                : "bg-status-warn/10 text-status-warn hover:bg-status-warn/20"
            }`}
          >
            <Satellite className="h-3 w-3" />
            {satellite.name}
          </button>
        ))}
      </div>
    </div>
  );
}
