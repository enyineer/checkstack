import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import type { System } from "@checkstack/catalog-common";
import { aiAccess } from "@checkstack/ai-common";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
} from "@checkstack/ui";
import { Brain } from "lucide-react";
import { MemoryList } from "./MemoryList";

/**
 * Fills catalog's `SystemMetaSlot` (the System Details "About" sidebar, next to
 * Contacts / Links / Groups) with a compact "Assistant Memories" button.
 * Clicking it opens a Sheet listing the `system`-scoped memories the assistant
 * has saved about THIS system. This replaces the old always-open card that ate
 * the whole sidebar.
 *
 * Reading memories requires the dedicated `ai.memory.read` rule (not just system
 * read), so the button hides entirely - and never fires `listMemories` - for
 * users who lack it. Delete / always-apply inside the sheet are server-enforced
 * (`ai.memory.manage`).
 */
export function SystemMemoryButton({ system }: { system: System }) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canReadMemory } = accessApi.useAccess(aiAccess.memoryRead);
  const [open, setOpen] = useState(false);

  if (!canReadMemory) return null;

  return (
    <div className="border-t border-border/60 pt-4">
      <Button
        variant="outline"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <Brain className="mr-2 h-4 w-4" />
        Assistant Memories
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent size="lg">
          <SheetHeader>
            <SheetTitle>Assistant memory</SheetTitle>
            <SheetDescription>
              Durable facts the assistant has saved about {system.name}. Delete
              any that are stale, or toggle whether one is always applied.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <MemoryList
              systemId={system.id}
              emptyTitle="No memories for this system"
              emptyDescription="The assistant saves a memory here when it learns a lasting, non-obvious fact about this system."
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
