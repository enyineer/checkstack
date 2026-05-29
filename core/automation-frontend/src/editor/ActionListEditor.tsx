import React from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DynamicIcon,
} from "@checkstack/ui";
import type {
  ActionInput,
  ActionPath,
  ActionPathStep,
} from "@checkstack/automation-common";
import {
  ACTION_KIND_META,
  ACTION_KINDS,
  type ActionKind,
  makeEmptyAction,
} from "./action-helpers";
import { ActionEditor } from "./ActionEditor";
import { useAutomationDefinitionContext } from "./AutomationDefinitionContext";

type Slot = ActionPathStep["slot"];

export interface ActionListEditorProps {
  value: ActionInput[];
  onChange: (next: ActionInput[]) => void;
  /** Path of the parent action — empty array means we're at the root. */
  parentPath: ActionPath;
  /**
   * Describes which child slot of the parent contains this list. Drives
   * `ActionPathStep`s for nested resolution. Use `{ slot: "root" }` at the
   * top of the editor; composite cards pass their own (`"choose-when"` with
   * `whenIndex`, `"parallel"`, `"repeat"`, `"sequence"`, `"choose-else"`).
   */
  slotForChildren: { slot: Slot; whenIndex?: number };
  disabled?: boolean;
}

let idCounter = 0;
const nextId = (): string => {
  idCounter += 1;
  return `act-${idCounter}`;
};

/**
 * Sortable list of actions. The hard parts:
 *
 *   1. **Drag-to-reorder** — we pair every value-slot with a stable
 *      `string` id (kept in a parallel array). Reorders shuffle both
 *      arrays together; edits don't touch the id array, so each card's
 *      expanded-state survives parent re-renders.
 *
 *   2. **Path computation** — each child's `ActionPath` is the parent
 *      path plus a final segment describing the child's position. The
 *      segment's `slot` comes from `slotForChildren`; the `index` is
 *      the child's position in the array.
 *
 *   3. **Add menu** — a small popover lets the operator pick which
 *      action kind to insert. Composite kinds (`choose`, `parallel`,
 *      `repeat`, `sequence`) prime themselves with one nested
 *      `action` so the operator immediately sees something concrete.
 */
export const ActionListEditor: React.FC<ActionListEditorProps> = ({
  value,
  onChange,
  parentPath,
  slotForChildren,
  disabled,
}) => {
  const { definition } = useAutomationDefinitionContext();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Parallel id array; kept in sync with `value`'s length so reorders +
  // add + delete are stable, while in-place edits don't churn keys.
  const [ids, setIds] = React.useState<string[]>(() => value.map(() => nextId()));
  React.useEffect(() => {
    setIds((current) => {
      if (current.length === value.length) return current;
      if (current.length < value.length) {
        return [
          ...current,
          ...Array.from({ length: value.length - current.length }, nextId),
        ];
      }
      return current.slice(0, value.length);
    });
  }, [value.length]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = ids.indexOf(String(event.active.id));
    const newIndex = ids.indexOf(String(event.over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setIds(arrayMove(ids, oldIndex, newIndex));
    onChange(arrayMove(value, oldIndex, newIndex));
  };

  const childPathAt = (index: number): ActionPath => [
    ...parentPath,
    {
      slot: slotForChildren.slot,
      whenIndex: slotForChildren.whenIndex,
      index,
    },
  ];

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {value.map((action, index) => (
            <SortableActionItem
              key={ids[index]}
              id={ids[index]!}
              value={action}
              onChange={(next) => {
                const list = [...value];
                list[index] = next;
                onChange(list);
              }}
              onDelete={() => {
                onChange(value.filter((_, i) => i !== index));
                setIds((current) => current.filter((_, i) => i !== index));
              }}
              path={childPathAt(index)}
              definition={definition}
              disabled={disabled}
            />
          ))}
        </SortableContext>
      </DndContext>
      {value.length === 0 && (
        <p className="text-xs italic text-muted-foreground">No steps yet.</p>
      )}
      <AddActionPopover
        disabled={disabled}
        onAdd={(kind) => {
          onChange([...value, makeEmptyAction(kind)]);
          setIds((current) => [...current, nextId()]);
        }}
      />
    </div>
  );
};

const SortableActionItem: React.FC<{
  id: string;
  value: ActionInput;
  onChange: (next: ActionInput) => void;
  onDelete: () => void;
  path: ActionPath;
  definition: Parameters<typeof ActionEditor>[0]["definition"];
  disabled?: boolean;
}> = ({ id, value, onChange, onDelete, path, definition, disabled }) => {
  const sortable = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div ref={sortable.setNodeRef} style={style}>
      <ActionEditor
        value={value}
        onChange={onChange}
        onDelete={onDelete}
        path={path}
        definition={definition}
        stableId={id}
        dragHandleProps={{
          ...sortable.attributes,
          ...sortable.listeners,
        }}
        disabled={disabled}
      />
    </div>
  );
};

const AddActionPopover: React.FC<{
  onAdd: (kind: ActionKind) => void;
  disabled?: boolean;
}> = ({ onAdd, disabled }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="h-7 text-xs"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add step
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" align="start">
        <div className="space-y-0.5">
          {ACTION_KINDS.map((kind) => {
            const meta = ACTION_KIND_META[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAdd(kind);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <DynamicIcon
                  name={meta.icon}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <div className="flex-1">
                  <div className="font-medium">{meta.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {meta.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
