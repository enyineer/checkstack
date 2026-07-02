import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { aiAccess } from "@checkstack/ai-common";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
 * Contributes an "Assistant memory" section to the platform About page
 * (`AboutSectionsSlot`). Instead of the old always-open, oversized card, this is
 * a compact card with a single "Memories" button that opens a Sheet listing
 * every memory the user can see (their preferences plus `system` memories for
 * systems they can read).
 *
 * Reading memories requires the dedicated `ai.memory.read` rule (not just being
 * able to open About), so the whole section hides - and never fires
 * `listMemories` - for users who lack it. Delete/always-apply inside the list
 * are server-enforced (`ai.memory.manage`).
 */
export function AboutMemoriesButton() {
  const accessApi = useApi(accessApiRef);
  const { allowed: canReadMemory } = accessApi.useAccess(aiAccess.memoryRead);
  const [open, setOpen] = useState(false);

  if (!canReadMemory) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Brain className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Assistant memory</CardTitle>
        </div>
        <CardDescription>
          Durable notes the assistant recalls across conversations: your
          preferences and lasting facts about your systems.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Brain className="mr-2 h-4 w-4" />
          Memories
        </Button>
      </CardContent>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent size="lg">
          <SheetHeader>
            <SheetTitle>Assistant memory</SheetTitle>
            <SheetDescription>
              Every memory the assistant has saved that you can see. Delete any
              that are stale, or toggle whether one is always applied.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <MemoryList
              emptyTitle="No memories saved yet"
              emptyDescription="When you tell the assistant a durable preference (e.g. 'file infra tickets in OPS') or it learns a lasting fact about a system, it saves a memory here for future conversations."
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
