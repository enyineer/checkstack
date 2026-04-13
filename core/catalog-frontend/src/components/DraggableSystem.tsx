import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Edit, Trash2, FolderPlus } from "lucide-react";
import { Button } from "@checkstack/ui";
import { ExtensionSlot } from "@checkstack/frontend-api";
import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";
import type { Group, System } from "../api";

interface DraggableSystemProps {
  system: System;
  groups: Group[];
  assignedGroupIds: string[];
  onEdit: (system: System) => void;
  onDelete: (id: string) => void;
  onAddToGroup: (systemId: string, groupId: string) => void;
}

/**
 * A draggable system card for the Catalog Management page.
 *
 * Layout: two-row design so the system name is never truncated.
 *   Row 1: grip handle + full-width name + description
 *   Row 2 (footer): extension slot (Health Checks etc.) + action buttons
 *
 * On touch / small screens, the + button opens an inline group picker
 * since drag-and-drop can be imprecise on small viewports.
 *
 * We intentionally do NOT apply the useDraggable transform to the element —
 * DragOverlay handles the moving visual, keeping the original in-place.
 */
export const DraggableSystem = ({
  system,
  groups,
  assignedGroupIds,
  onEdit,
  onDelete,
  onAddToGroup,
}: DraggableSystemProps) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const { attributes, listeners, setNodeRef } = useDraggable({
    id: system.id,
  });

  const availableGroups = groups.filter((g) => !assignedGroupIds.includes(g.id));

  return (
    <div
      ref={setNodeRef}
      className="bg-muted/30 rounded-lg border border-border transition-all duration-150"
    >
      {/* Main row: grip + name/description */}
      <div className="flex items-start gap-2 p-3 pb-2">
        {/* Grip handle — only this element triggers the drag */}
        <div
          {...listeners}
          {...attributes}
          className="flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none"
          aria-label={`Drag ${system.name}`}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Name + description — gets all remaining width, never truncated */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground leading-snug">
            {system.name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {system.description || "No description"}
          </p>
        </div>
      </div>

      {/* Footer row: unassigned badge (left) + all action buttons (right) */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pl-9">
        {/* Left: unassigned badge */}
        <div className="min-w-0">
          {assignedGroupIds.length === 0 && (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning-foreground font-mono">
              unassigned
            </span>
          )}
        </div>

        {/* Right: extension slot + action buttons, all grouped together */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <ExtensionSlot
            slot={CatalogSystemActionsSlot}
            context={{ systemId: system.id, systemName: system.name }}
          />

          {/* Group picker */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title={`Add ${system.name} to a group`}
              onClick={() => setIsPickerOpen((v) => !v)}
              disabled={availableGroups.length === 0}
              aria-expanded={isPickerOpen}
              aria-haspopup="listbox"
              aria-label={`Add ${system.name} to group`}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>

            {isPickerOpen && availableGroups.length > 0 && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsPickerOpen(false)}
                />
                <div
                  role="listbox"
                  aria-label="Select a group"
                  className="absolute right-0 bottom-full mb-1 z-50 min-w-[160px] rounded-md border border-border bg-popover shadow-md py-1"
                >
                  {availableGroups.map((group) => (
                    <button
                      key={group.id}
                      role="option"
                      aria-selected={false}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                      onClick={() => {
                        onAddToGroup(system.id, group.id);
                        setIsPickerOpen(false);
                      }}
                    >
                      {group.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onEdit(system)}
            aria-label={`Edit ${system.name}`}
          >
            <Edit className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive/90 hover:bg-destructive/10 h-7 w-7 p-0"
            onClick={() => onDelete(system.id)}
            aria-label={`Delete ${system.name}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * A non-interactive ghost card shown in the DragOverlay while dragging.
 */
export const SystemDragOverlay = ({ system }: { system: System }) => (
  <div className="flex items-center gap-2 p-3 bg-card rounded-lg border border-primary/50 shadow-lg cursor-grabbing w-full">
    <GripVertical className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="font-medium text-foreground">{system.name}</p>
      <p className="text-xs text-muted-foreground">
        {system.description || "No description"}
      </p>
    </div>
  </div>
);
