import { usePluginClient } from "@checkstack/frontend-api";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import { TelemetryApi } from "@checkstack/telemetry-common";

/**
 * Picker for a derive source's INPUT log stream. Fed by the same
 * `listBindableStreams({ signal: "logs" })` the binding editor uses, so it only
 * offers streams the caller may manage - which is exactly the set a deriver may
 * legitimately read from. A currently-selected stream that is no longer listable
 * is kept visible as a synthetic option so an existing config never silently
 * loses its input.
 */
export function InputStreamPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (streamId: string) => void;
  disabled?: boolean;
}) {
  const client = usePluginClient(TelemetryApi);
  const { data, isLoading } = client.listBindableStreams.useQuery({ signal: "logs" });

  const streams = data?.streams ?? [];
  const hasSelectedListed = streams.some((s) => s.id === value);
  const empty = !isLoading && streams.length === 0 && value.length === 0;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="derive-input-stream">Input log stream</Label>
      <Select
        value={value.length === 0 ? undefined : value}
        onValueChange={onChange}
        disabled={disabled || isLoading || empty}
      >
        <SelectTrigger id="derive-input-stream">
          <SelectValue
            placeholder={
              isLoading
                ? "Loading streams..."
                : empty
                  ? "No log streams you can read"
                  : "Select a log stream"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {/* Keep a selected-but-unlisted stream visible so the config is stable. */}
          {value.length > 0 && !hasSelectedListed && (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {streams.map((stream) => (
            <SelectItem key={stream.id} value={stream.id}>
              {stream.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        The log stream this source derives from. You must be able to manage the
        stream to read it.
      </p>
    </div>
  );
}
