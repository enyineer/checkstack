import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AiApi } from "@checkstack/ai-common";
import {
  Badge,
  Button,
  Toggle,
  EmptyState,
  LoadingSpinner,
  ConfirmationModal,
} from "@checkstack/ui";
import { Brain, Trash2 } from "lucide-react";

/**
 * Lists the saved AI memories the user can see and lets them delete one.
 *
 * Shared by the Memories settings page (no `systemId` -> all visible memories)
 * and the system-detail card (`systemId` -> that system's `system`-scoped
 * memories). Scoping + delete authority are enforced server-side; this is a thin
 * read/delete view. `deleteMemory` is an AiApi mutation, so it auto-invalidates
 * this plugin's queries on success and the list refetches without manual wiring.
 */
export function MemoryList({
  systemId,
  emptyTitle = "No memories yet",
  emptyDescription,
}: {
  systemId?: string;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
}) {
  const ai = usePluginClient(AiApi);
  const { data, isLoading } = ai.listMemories.useQuery(
    systemId ? { systemId } : {},
  );
  const deleteMemory = ai.deleteMemory.useMutation();
  const setAlwaysInject = ai.setMemoryAlwaysInject.useMutation();
  const [pending, setPending] = useState<
    { id: string; recallHint: string } | undefined
  >();

  const memories = data?.memories ?? [];

  if (isLoading) return <LoadingSpinner />;

  if (memories.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-7 w-7" />}
        title={emptyTitle}
        description={
          emptyDescription ??
          "The assistant saves a memory when you state a durable preference or it learns a lasting fact. They show up here."
        }
      />
    );
  }

  const confirmDelete = async () => {
    const target = pending;
    if (!target) return;
    await deleteMemory.mutateAsync({ id: target.id });
    setPending(undefined);
  };

  return (
    <>
      <ul className="space-y-2">
        {memories.map((m) => (
          <li
            key={m.id}
            className="space-y-1 rounded-md border bg-card p-3"
          >
            {/* Title row spans the full width so the trash icon sits flush right. */}
            <div className="flex items-center gap-2">
              <Badge variant={m.scope === "system" ? "secondary" : "outline"}>
                {m.scope === "system" ? "System" : "Preference"}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {m.recallHint}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete memory"
                title="Delete memory"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setPending({ id: m.id, recallHint: m.recallHint })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {m.content}
            </p>
            {/* Footer also spans full width, so "Always apply" aligns flush right
                with the trash icon above it (no gap). Items bottom-align so the
                "Saved" text sits on the same baseline as the taller toggle. */}
            <div className="flex items-end justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Saved {new Date(m.savedAt).toLocaleDateString()}
                {!systemId && m.scope === "system" && m.systemId
                  ? ` · system ${m.systemId}`
                  : null}
              </span>
              <span className="flex items-center gap-1.5">
                <span>Always apply</span>
                <Toggle
                  checked={m.alwaysInject}
                  disabled={setAlwaysInject.isPending}
                  aria-label="Always apply this memory"
                  onCheckedChange={(checked) =>
                    void setAlwaysInject.mutateAsync({
                      id: m.id,
                      alwaysInject: checked,
                    })
                  }
                />
              </span>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmationModal
        isOpen={Boolean(pending)}
        onClose={() => setPending(undefined)}
        onConfirm={() => void confirmDelete()}
        title="Delete memory"
        message={`Delete "${pending?.recallHint ?? ""}"? The assistant will no longer recall it.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMemory.isPending}
      />
    </>
  );
}
