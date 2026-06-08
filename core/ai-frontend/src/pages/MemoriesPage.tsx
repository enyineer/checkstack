import { PageLayout, Card, CardContent } from "@checkstack/ui";
import { Brain } from "lucide-react";
import { MemoryList } from "../components/MemoryList";

/**
 * Settings page listing every memory the user can see — their own preferences
 * plus `system` memories for systems they can read — with delete. The
 * assistant saves these; this is the human view/cleanup surface.
 */
export function MemoriesPage() {
  return (
    <PageLayout
      title="Assistant memory"
      subtitle="Durable notes the assistant recalls across conversations: your preferences and lasting facts about your systems. Delete any that are stale."
      icon={Brain}
    >
      <Card>
        <CardContent className="p-4">
          <MemoryList
            emptyTitle="No memories saved yet"
            emptyDescription="When you tell the assistant a durable preference (e.g. 'file infra tickets in OPS') or it learns a lasting fact about a system, it saves a memory here for future conversations."
          />
        </CardContent>
      </Card>
    </PageLayout>
  );
}
