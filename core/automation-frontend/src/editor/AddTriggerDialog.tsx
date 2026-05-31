import React from "react";
import { Zap } from "lucide-react";
import { useAutomationRegistry } from "./registry-context";
import { PickerDialogShell, PickerRow } from "./picker-dialog";

export interface AddTriggerDialogProps {
  /** Append a trigger subscribed to the picked event's qualified id. */
  onAdd: (event: string) => void;
  disabled?: boolean;
}

/**
 * Home-Assistant-style trigger type picker. The operator picks a concrete
 * trigger event (grouped by category, searchable) up front; on pick the
 * consumer (`TriggersEditor`) creates the trigger with a unique default id and
 * appends it. Mirrors the Actions "Add step" picker but is single-list.
 */
export const AddTriggerDialog: React.FC<AddTriggerDialogProps> = ({
  onAdd,
  disabled,
}) => {
  const { triggers } = useAutomationRegistry();

  const items = React.useMemo(
    () =>
      triggers.map((t) => ({
        id: t.qualifiedId,
        label: t.displayName,
        description: t.description,
        category: t.category,
      })),
    [triggers],
  );

  return (
    <PickerDialogShell
      addLabel="Add trigger"
      title="Add trigger"
      searchPlaceholder="Search triggers…"
      disabled={disabled}
    >
      {({ query, close }) => {
        const filtered = query
          ? items.filter(
              (item) =>
                item.label.toLowerCase().includes(query) ||
                item.id.toLowerCase().includes(query) ||
                item.description?.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query),
            )
          : items;

        const groups = new Map<string, typeof filtered>();
        for (const item of filtered) {
          const list = groups.get(item.category) ?? [];
          list.push(item);
          groups.set(item.category, list);
        }
        const grouped = [...groups.entries()].toSorted(([a], [b]) =>
          a.localeCompare(b),
        );

        if (grouped.length === 0) {
          return (
            <p className="px-1 py-6 text-center text-xs italic text-muted-foreground">
              No matching triggers.
            </p>
          );
        }

        return (
          <div className="space-y-3">
            {grouped.map(([category, list]) => (
              <div key={category} className="space-y-1">
                <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {category}
                </p>
                {list.map((item) => (
                  <PickerRow
                    key={item.id}
                    icon={<Zap className="h-4 w-4" />}
                    title={item.label}
                    description={item.description}
                    onClick={() => {
                      onAdd(item.id);
                      close();
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      }}
    </PickerDialogShell>
  );
};
