import React from "react";
import { Pencil, List } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { CatalogApi } from "@checkstack/catalog-common";
import { Button, Input } from "@checkstack/ui";
import { ItemPicker } from "./ItemPicker";
import { shouldStartManual } from "./system-entity-picker.logic";

export interface SystemEntityPickerProps {
  /** Current entity value — a catalog system id, or a free-form id / template. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Live system picker for a `state` condition's `entity`. Backed by the
 * catalog `getSystems` RPC so an operator picks from the registered systems
 * instead of typing a raw id.
 *
 * Keeps a manual-entry fallback: an id not present in the catalog (e.g. a
 * system that will exist at run time, or a `{{ … }}` template) must still
 * round-trip losslessly, so the picker switches to a plain text input when
 * the current value isn't a known system id, and an explicit toggle lets the
 * operator force manual entry. The value is always a bare string either way,
 * so the saved `definition` is unchanged.
 */
export const SystemEntityPicker: React.FC<SystemEntityPickerProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const catalogClient = usePluginClient(CatalogApi);
  const { data } = catalogClient.getSystems.useQuery({});
  const systems = React.useMemo(() => data?.systems ?? [], [data]);

  const items = React.useMemo(
    () =>
      systems.map((system) => ({
        id: system.id,
        label: system.name,
        description: system.id,
      })),
    [systems],
  );

  // Drop to manual entry for templates or ids that aren't (yet) in the
  // catalog so the value still round-trips; an explicit toggle also forces
  // it. A blank value defaults to the picker (the common case).
  const [manual, setManual] = React.useState(() =>
    shouldStartManual({
      value,
      knownSystemIds: new Set(systems.map((system) => system.id)),
    }),
  );

  if (manual) {
    return (
      <div className="flex items-center gap-2">
        <Input
          className="font-mono text-xs"
          value={value}
          placeholder="payments-api or {{ trigger.payload.system }}"
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setManual(false)}
          disabled={disabled}
          aria-label="Pick from catalog systems"
          title="Pick from catalog systems"
        >
          <List className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <ItemPicker
          items={items}
          value={value || undefined}
          onSelect={onChange}
          placeholder="Pick a system"
          emptyText="No systems in the catalog"
          disabled={disabled}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => setManual(true)}
        disabled={disabled}
        aria-label="Enter a system id or template manually"
        title="Enter a system id or template manually"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
