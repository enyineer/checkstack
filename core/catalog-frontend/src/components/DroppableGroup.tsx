import { useDroppable } from "@dnd-kit/core";
import { EditableText, Button } from "@checkstack/ui";
import { Trash2 } from "lucide-react";
import type { Group, System } from "../api";

interface DroppableGroupProps {
  group: Group;
  systems: System[];
  isOver: boolean;
  isDragging: boolean;
  draggingSystemAlreadyInGroup: boolean;
  newlyAddedSystemId?: string;
  onDeleteGroup: (id: string) => void;
  onUpdateGroupName: (id: string, name: string) => void;
  onRemoveSystem: (groupId: string, systemId: string) => void;
}

/**
 * A droppable group card for the Catalog Management page.
 *
 * When a system is being dragged over, the card highlights. If the system
 * is already assigned to this group, the drop zone shows a "Already in group"
 * indicator and the drop is blocked visually.
 */
export const DroppableGroup = ({
  group,
  systems,
  isOver,
  isDragging,
  draggingSystemAlreadyInGroup,
  newlyAddedSystemId,
  onDeleteGroup,
  onUpdateGroupName,
  onRemoveSystem,
}: DroppableGroupProps) => {
  const { setNodeRef } = useDroppable({ id: group.id });

  const groupSystems = (group.systemIds ?? [])
    .map((sysId) => systems.find((s) => s.id === sysId))
    .filter((sys): sys is System => !!sys);

  const dropzoneActive = isDragging;

  return (
    <div
      ref={setNodeRef}
      className={`p-3 rounded-lg border space-y-2 transition-all duration-150 ${
        isOver && !draggingSystemAlreadyInGroup
          ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
          : isOver && draggingSystemAlreadyInGroup
            ? "border-muted-foreground/40 bg-muted/10"
            : dropzoneActive
              ? "border-border/60 bg-muted/20 border-dashed"
              : "border-border bg-muted/30"
      }`}
    >
      {/* Group header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <EditableText
            value={group.name}
            onSave={(newName) => onUpdateGroupName(group.id, newName)}
            className="font-medium text-foreground"
          />
          <p className="text-xs text-muted-foreground font-mono">{group.id}</p>
        </div>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive/90 hover:bg-destructive/10 h-8 w-8 p-0"
          onClick={() => onDeleteGroup(group.id)}
          aria-label={`Delete group ${group.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Drop zone label */}
      {isOver && (
        <div
          className={`text-xs text-center py-1 rounded transition-colors ${
            draggingSystemAlreadyInGroup
              ? "text-muted-foreground"
              : "text-primary font-medium"
          }`}
        >
          {draggingSystemAlreadyInGroup
            ? "Already in this group"
            : "Drop to add"}
        </div>
      )}

      {/* Systems in this group */}
      {groupSystems.length > 0 ? (
        <div className="pl-2 space-y-1">
          {groupSystems.map((sys) => {
            const isNew = newlyAddedSystemId === sys.id;
            return (
              <div
                key={sys.id}
                className={`flex items-center justify-between text-sm bg-background p-2 rounded border transition-all duration-700 ${
                  isNew
                    ? "border-green-500/60 shadow-sm shadow-green-500/30"
                    : "border-border shadow-none"
                }`}
              >
                <span className="text-foreground truncate">{sys.name}</span>
                <Button
                  variant="ghost"
                  className="text-destructive/60 hover:text-destructive h-6 w-6 p-0 flex-shrink-0"
                  onClick={() => onRemoveSystem(group.id, sys.id)}
                  aria-label={`Remove ${sys.name} from ${group.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty drop zone hint */
        <div
          className={`text-xs text-center py-3 rounded border border-dashed transition-colors ${
            dropzoneActive
              ? "border-primary/40 text-primary/60"
              : "border-border text-muted-foreground/60"
          }`}
        >
          {dropzoneActive ? "Drag a system here" : "No systems assigned"}
        </div>
      )}
    </div>
  );
};
