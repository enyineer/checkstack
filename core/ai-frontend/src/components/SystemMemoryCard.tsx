import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@checkstack/ui";
import type { System } from "@checkstack/catalog-common";
import { MemoryList } from "./MemoryList";

/**
 * Fills the catalog `SystemDetailsSlot` with the assistant's saved memories for
 * THIS system (`system`-scoped only). Visible to anyone who can read the system
 * (server-enforced); delete requires manage. Lets an operator see and prune what
 * the assistant has learned about a system without opening the chat.
 */
export function SystemMemoryCard({ system }: { system: System }) {
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
