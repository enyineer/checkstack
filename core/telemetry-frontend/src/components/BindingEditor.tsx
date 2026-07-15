import { usePluginClient } from "@checkstack/frontend-api";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import {
  TelemetryApi,
  type SourceTypeDescriptor,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import {
  buildStreamOptions,
  fromStreamValue,
  signalLabel,
  toStreamValue,
  type BindingSelection,
} from "../lib/binding-editor.logic";

export interface BindingEditorProps {
  descriptor: SourceTypeDescriptor;
  /** Per-signal stream selection. */
  selection: BindingSelection;
  onChange: (next: BindingSelection) => void;
  /**
   * Resolved stream names per signal from the edited source's read DTO. Used to
   * label the synthetic "kept but no longer listable" option with its real name
   * instead of a generic fallback. Absent when creating.
   */
  bindingStreamNames?: Partial<Record<TelemetrySignal, string | null>>;
  disabled?: boolean;
}

/**
 * Multi-signal binding editor: one stream picker per signal the type emits.
 * Each picker is fed by `listBindableStreams` for its signal (the streams the
 * caller may manage) and offers a "Not routed" option, so a signal can be left
 * unbound as long as one remains bound overall (the dialog enforces the
 * at-least-one rule before submit). A currently-selected stream that is no
 * longer listable is kept visible as a synthetic option.
 */
export function BindingEditor({
  descriptor,
  selection,
  onChange,
  bindingStreamNames,
  disabled,
}: BindingEditorProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Stream routing</Label>
        <p className="text-xs text-muted-foreground">
          Route each signal this source emits into a stream you manage. Leave a
          signal unrouted to drop it; at least one must be routed.
        </p>
      </div>
      <div className="space-y-3">
        {descriptor.signals.map((signal) => (
          <SignalBindingRow
            key={signal}
            signal={signal}
            selectedId={selection[signal] ?? null}
            selectedName={bindingStreamNames?.[signal] ?? null}
            onSelect={(streamId) =>
              onChange({ ...selection, [signal]: streamId })
            }
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One signal's stream picker. Isolated as its own component so each signal owns
 * a stable `listBindableStreams` query (React hook rules) regardless of how many
 * signals the type emits.
 */
function SignalBindingRow({
  signal,
  selectedId,
  selectedName,
  onSelect,
  disabled,
}: {
  signal: TelemetrySignal;
  selectedId: string | null;
  /** Resolved name of the selected stream, to label a synthetic option. */
  selectedName?: string | null;
  onSelect: (streamId: string | null) => void;
  disabled?: boolean;
}) {
  const client = usePluginClient(TelemetryApi);
  const { data, isLoading } = client.listBindableStreams.useQuery({ signal });

  const bindable = data?.streams ?? [];
  const options = buildStreamOptions({ bindable, selectedId, selectedName });
  // A signal has nowhere to route when the picker resolved to no streams AND
  // nothing is already selected (no sink, or the caller manages none).
  const empty = !isLoading && options.length === 0;
  const selectId = `binding-${signal}`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId}>{signalLabel(signal)}</Label>
      <Select
        value={toStreamValue(selectedId)}
        onValueChange={(value) => onSelect(fromStreamValue(value))}
        disabled={disabled || isLoading || empty}
      >
        <SelectTrigger id={selectId}>
          <SelectValue
            placeholder={
              isLoading
                ? "Loading streams..."
                : empty
                  ? "No streams you can bind"
                  : "Not routed"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={toStreamValue(null)}>Not routed</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {empty && (
        <p className="text-xs text-muted-foreground">
          You do not manage any {signalLabel(signal).toLowerCase()} streams to
          route into.
        </p>
      )}
    </div>
  );
}
