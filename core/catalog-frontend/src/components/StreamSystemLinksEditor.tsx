import { useMemo } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { SystemMultiSelect, Label, Button } from "@checkstack/ui";
import { Plus } from "lucide-react";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  matchSuggestions,
  DEFAULT_SUGGESTION_CAP,
  type SuggestibleSystem,
} from "./stream-system-suggestions.logic";

/**
 * Observed `service.name` values from the calling stream plugin, used only to
 * SUGGEST systems to link. The source differs per plugin (logs/metrics/traces);
 * this editor does not care where they come from.
 */
export interface StreamSystemSuggestions {
  /** Distinct `service.name` values observed on the stream. */
  serviceNames: string[];
  /** True while the caller is still loading its observed service names. */
  loading?: boolean;
}

export interface StreamSystemLinksEditorProps {
  /** Currently linked catalog-system ids (controlled). */
  value: string[];
  /** Emitted with the full new set whenever a system is added or removed. */
  onChange: (systemIds: string[]) => void;
  /**
   * Disables all interaction (e.g. while the caller's save mutation is in
   * flight, or when the caller's gate says the user may not manage links). The
   * caller owns the mutation and its gating via its own `useGatedMutation`.
   */
  disabled?: boolean;
  /**
   * Optional observed service names. When matches against catalog systems
   * exist, they render as clickable "add" chips. Suggestions are NEVER
   * auto-applied - a human clicks each chip to link that system.
   */
  suggestions?: StreamSystemSuggestions;
  /** Max suggestion chips to display. Defaults to {@link DEFAULT_SUGGESTION_CAP}. */
  suggestionCap?: number;
}

/**
 * Shared editor for a stream's EXPLICIT links to catalog systems. Renders a
 * searchable system picker plus, when the caller supplies observed
 * `service.name` values, a quiet row of suggestion chips a human can click to
 * link the matching system. Controlled: the caller holds `value` and owns the
 * save mutation.
 *
 * Access nuance: the backend link-write gate is "the caller can READ every
 * linked system" (`assertCatalogResourcesReadable`), NOT manage. `getSystems`
 * is RLAC'd with `instanceAccess: { listKey: "systems" }` on the `system.read`
 * rule, so it already returns EXACTLY the systems the caller may read - the
 * correct offer set, correct-by-construction. We therefore do NOT run an extra
 * `useManageableResources` (manage) filter, which would wrongly hide readable
 * systems a team member could legitimately link. We only mirror the `keepIds`
 * idea: any already-linked id that is no longer in the readable set is kept
 * visible (labelled by id) so editing does not silently drop it.
 */
export function StreamSystemLinksEditor({
  value,
  onChange,
  disabled = false,
  suggestions,
  suggestionCap = DEFAULT_SUGGESTION_CAP,
}: StreamSystemLinksEditorProps) {
  const catalogClient = usePluginClient(CatalogApi);
  const { data } = catalogClient.getSystems.useQuery({});
  const readableSystems: SuggestibleSystem[] = useMemo(
    () => data?.systems.map((s) => ({ id: s.id, name: s.name })) ?? [],
    [data],
  );

  // Keep-selected: an already-linked system the caller can no longer read is
  // still shown (labelled by its id) so an edit does not silently drop it.
  const pickerSystems = useMemo(() => {
    const known = new Set(readableSystems.map((s) => s.id));
    const kept = value
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id }));
    return [...readableSystems, ...kept];
  }, [readableSystems, value]);

  const matched = useMemo(() => {
    if (!suggestions || suggestions.serviceNames.length === 0) return [];
    return matchSuggestions({
      serviceNames: suggestions.serviceNames,
      systems: readableSystems,
      linkedIds: value,
      cap: suggestionCap,
    });
  }, [suggestions, readableSystems, value, suggestionCap]);

  const addSystem = (id: string) => {
    if (value.includes(id)) return;
    onChange([...value, id]);
  };

  // While the caller is still loading its observed service names and nothing
  // has matched yet, show a quiet "looking" affordance so an empty result is
  // distinguishable from "still loading". Once chips exist we show them even if
  // more names are still streaming in.
  const suggestionsLoading =
    Boolean(suggestions?.loading) && matched.length === 0;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0">
      <div className="space-y-1.5">
        <Label id="stream-system-links-label">Linked systems</Label>
        <SystemMultiSelect
          systems={pickerSystems}
          selectedIds={value}
          onChange={onChange}
          labelledBy="stream-system-links-label"
          emptyText="No systems available to link"
          countLabel={(n) => `${n} system(s) linked`}
        />
      </div>

      {matched.length > 0 && (
        <div className="space-y-2 rounded-md border bg-surface-inset p-3">
          <p className="text-xs text-muted-foreground">
            Suggested from observed service names
          </p>
          <div className="flex flex-wrap gap-2">
            {matched.map((system) => (
              <Button
                key={system.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => addSystem(system.id)}
              >
                <Plus className="size-3.5" />
                {system.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {suggestionsLoading && (
        <div className="rounded-md border bg-surface-inset p-3">
          <p className="text-xs text-muted-foreground">
            Looking for observed service names&hellip;
          </p>
        </div>
      )}
    </fieldset>
  );
}
