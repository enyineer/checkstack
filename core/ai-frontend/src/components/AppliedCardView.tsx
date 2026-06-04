import { Card, CardHeader, CardTitle, CardContent, Badge } from "@checkstack/ui";
import { CheckCircle2 } from "lucide-react";
import type { AppliedCard } from "../lib/stream-parser";
import { DiffView } from "./DiffView";

/**
 * Read-only card for a change the assistant AUTO-APPLIED (auto mode). The change
 * already took effect, so there are no Apply/Decline buttons - this exists so the
 * operator ALWAYS sees what was changed or created, even when no confirmation was
 * required. For an update it shows the before -> after diff; for a create it shows
 * the created object.
 */
export function AppliedCardView({ card }: { card: AppliedCard }) {
  const hasDiff = card.diff && card.diff.length > 0;
  return (
    <Card className="border-primary/40">
      <CardHeader className="flex flex-row items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-primary" />
        <CardTitle className="text-sm">Applied: {card.toolName}</CardTitle>
        <Badge variant="secondary">applied</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{card.summary}</p>
        {hasDiff ? (
          <div className="rounded bg-muted p-2">
            <DiffView diff={card.diff ?? []} />
          </div>
        ) : card.result !== undefined && card.result !== null ? (
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">
            {JSON.stringify(card.result, null, 2)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
