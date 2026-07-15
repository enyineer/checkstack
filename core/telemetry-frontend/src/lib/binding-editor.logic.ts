import type {
  BindableStream,
  SourceBinding,
  SourceTypeDescriptor,
  TelemetrySignal,
  TelemetrySource,
} from "@checkstack/telemetry-common";

/**
 * Pure logic for the multi-signal binding editor. A source type emits one or
 * more signals (`descriptor.signals`); an instance routes each emitted signal
 * to at most one owning stream (or leaves it unbound). The editor holds a
 * per-signal selection; these helpers seed it, convert it to the contract's
 * `SourceBinding[]`, and build the per-signal picker options. Kept React-free
 * so the seeding / conversion / option rules are unit-testable.
 */

/** Per-signal stream selection: `null` (or absent) means "not routed". */
export type BindingSelection = Partial<Record<TelemetrySignal, string | null>>;

const SIGNAL_LABELS: Record<TelemetrySignal, string> = {
  logs: "Logs",
  metrics: "Metrics",
  traces: "Traces",
};

/** Human label for a signal (picker row heading). */
export function signalLabel(signal: TelemetrySignal): string {
  return SIGNAL_LABELS[signal];
}

/** Select value standing in for "leave this signal unbound". */
export const NOT_ROUTED_VALUE = "__telemetry_not_routed__";

/** Map a selected stream id (or null) to the Select's string value. */
export function toStreamValue(streamId: string | null | undefined): string {
  return streamId ?? NOT_ROUTED_VALUE;
}

/** Map a Select value back to a stream id (or null for "not routed"). */
export function fromStreamValue(value: string): string | null {
  return value === NOT_ROUTED_VALUE ? null : value;
}

/**
 * Seed the per-signal selection. Every signal the type emits starts unbound;
 * then, for an EDIT, each stored binding pre-fills its signal, and for a CREATE
 * opened from a stream section, the embedding `{presetSignal, presetStreamId}`
 * pre-fills that one signal. Additional signals stay unbound.
 */
export function initialBindingSelection({
  descriptor,
  source,
  presetSignal,
  presetStreamId,
}: {
  descriptor: SourceTypeDescriptor;
  source?: TelemetrySource | null;
  presetSignal?: TelemetrySignal | null;
  presetStreamId?: string | null;
}): BindingSelection {
  const selection: BindingSelection = {};
  for (const signal of descriptor.signals) selection[signal] = null;

  if (source) {
    for (const binding of source.bindings) {
      if (descriptor.signals.includes(binding.signal)) {
        selection[binding.signal] = binding.streamId;
      }
    }
    return selection;
  }

  if (
    presetSignal &&
    presetStreamId &&
    descriptor.signals.includes(presetSignal)
  ) {
    selection[presetSignal] = presetStreamId;
  }
  return selection;
}

/**
 * Convert the selection to the contract's binding array, dropping unbound
 * signals and any signal the type does not emit. Order follows the type's
 * declared signal order for stability.
 */
export function bindingsToArray({
  descriptor,
  selection,
}: {
  descriptor: SourceTypeDescriptor;
  selection: BindingSelection;
}): SourceBinding[] {
  const bindings: SourceBinding[] = [];
  for (const signal of descriptor.signals) {
    const streamId = selection[signal];
    if (streamId) bindings.push({ signal, streamId });
  }
  return bindings;
}

/** Whether the selection routes at least one signal (SourceBindings .min(1)). */
export function hasAtLeastOneBinding({
  descriptor,
  selection,
}: {
  descriptor: SourceTypeDescriptor;
  selection: BindingSelection;
}): boolean {
  return bindingsToArray({ descriptor, selection }).length > 0;
}

/** Presentation of one binding in the routing summary. */
export interface BindingSummaryText {
  /** Always shown: the signal name. */
  primary: string;
  /** The resolved stream name, or null when it did not resolve. */
  secondary: string | null;
  /** Tooltip: signal plus the resolved stream name, falling back to its id. */
  title: string;
}

/**
 * Describe one binding for the routing summary. The read DTO resolves stream
 * names into `bindingStreamNames` (null when the stream was deleted or its sink
 * is not installed); when a name is present it is shown next to the signal, else
 * the summary falls back to the signal alone with the stream id in the tooltip.
 */
export function bindingSummaryText({
  binding,
  streamName,
}: {
  binding: SourceBinding;
  streamName?: string | null;
}): BindingSummaryText {
  const primary = signalLabel(binding.signal);
  return {
    primary,
    secondary: streamName ?? null,
    title: streamName
      ? `${primary} → ${streamName}`
      : `${primary} → stream ${binding.streamId}`,
  };
}

/** One option in a signal's stream picker. */
export interface StreamOption {
  value: string;
  label: string;
  /** True for the synthetic "kept but no longer listable" fallback option. */
  synthetic: boolean;
}

/**
 * Build the picker options for one signal: the streams the caller may bind
 * (resolved names), plus a synthetic option keeping a currently-selected stream
 * visible when it is no longer in the bindable list (deleted, or the caller lost
 * manage on it). The source read DTO carries a resolved `bindingStreamNames`, so
 * pass the bound stream's `selectedName` to label the synthetic option with its
 * real name; it falls back to a generic label when the name is null/absent
 * (mirrors the satellite picker's missing-option pattern).
 */
export function buildStreamOptions({
  bindable,
  selectedId,
  selectedName,
}: {
  bindable: BindableStream[];
  selectedId: string | null;
  /** Resolved display name of the selected stream, when known. */
  selectedName?: string | null;
}): StreamOption[] {
  const options: StreamOption[] = bindable.map((stream) => ({
    value: stream.id,
    label: stream.name,
    synthetic: false,
  }));
  if (selectedId && !bindable.some((stream) => stream.id === selectedId)) {
    options.push({
      value: selectedId,
      label: selectedName ?? "Currently bound stream",
      synthetic: true,
    });
  }
  return options;
}
