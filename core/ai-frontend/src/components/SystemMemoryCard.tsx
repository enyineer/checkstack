import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@checkstack/ui";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import type { System } from "@checkstack/catalog-common";
import { aiAccess } from "@checkstack/ai-common";
import { MemoryList } from "./MemoryList";

/**
 * Fills the catalog `SystemDetailsSlot` with the assistant's saved memories for
 * THIS system (`system`-scoped only). Reading memories requires the separate
 * `ai.memory.read` rule (not just system read), so the card hides entirely -
 * and never fires `listMemories` - for users who lack it. Delete requires
 * manage (server-enforced). Lets an operator see and prune what the assistant
 * has learned about a system without opening the chat.
 */
export function SystemMemoryCard({ system }: { system: System }) {
  const accessApi = useApi(accessApiRef);
  const { allowed: canReadMemory } = accessApi.useAccess(aiAccess.memoryRead);
  if (!canReadMemory) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant memory</CardTitle>
        <CardDescription>
          Durable facts the assistant has saved about this system.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MemoryList
          systemId={system.id}
          emptyTitle="No memories for this system"
          emptyDescription="The assistant saves a memory here when it learns a lasting, non-obvious fact about this system."
        />
      </CardContent>
    </Card>
  );
}
