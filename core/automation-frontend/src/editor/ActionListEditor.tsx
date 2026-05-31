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
import type {
  ActionInput,
  ActionPath,
  ActionPathStep,
} from "@checkstack/automation-common";
import {
  assignDefaultIds,
  collectActionIds,
  duplicateAction,
  makeEmptyAction,
  makeProviderAction,
} from "./action-helpers";
import { ActionEditor } from "./ActionEditor";
import { AddActionDialog } from "./AddActionDialog";
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
 *   3. **Add menu** — `AddActionDialog` lets the operator decide the
 *      step's type up front: a concrete provider action (preset via
 *      `makeProviderAction`) or a structural building block. Composite
 *      kinds start with an empty child list, which the operator fills via
 *      the nested add-step picker.
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

  const appendStep = (action: ActionInput): void => {
    // Auto-assign log-friendly default ids (deduped against every id already
    // used anywhere in the automation), covering the new step and any
    // children composite kinds prime themselves with. The operator can
    // rename them in the card.
    const taken = collectActionIds(definition.actions);
    const [fresh] = assignDefaultIds([action], taken);
    onChange([...value, fresh!]);
    setIds((current) => [...current, nextId()]);
  };

  const duplicateStep = (index: number): void => {
    const original = value[index];
    if (!original) return;
    // Clone with FRESH ids deduped against every id in the automation so the
    // copy never collides with the original (or any sibling/nested step).
    const taken = collectActionIds(definition.actions);
    const clone = duplicateAction(original, taken);
    // Insert directly after the original, keeping the parallel `ids` array in
    // lockstep so each card's stable React key / drag id stays aligned.
    const nextValue = [
      ...value.slice(0, index + 1),
      clone,
      ...value.slice(index + 1),
    ];
    onChange(nextValue);
    setIds((current) => [
      ...current.slice(0, index + 1),
      nextId(),
      ...current.slice(index + 1),
    ]);
  };

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
              onDuplicate={disabled ? undefined : () => duplicateStep(index)}
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
      <AddActionDialog
        disabled={disabled}
        onAddKind={(kind) => appendStep(makeEmptyAction(kind))}
        onAddAction={(qualifiedId) => appendStep(makeProviderAction(qualifiedId))}
      />
    </div>
  );
};

const SortableActionItem: React.FC<{
  id: string;
  value: ActionInput;
  onChange: (next: ActionInput) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  path: ActionPath;
  definition: Parameters<typeof ActionEditor>[0]["definition"];
  disabled?: boolean;
}> = ({ id, value, onChange, onDelete, onDuplicate, path, definition, disabled }) => {
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
        onDuplicate={onDuplicate}
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
