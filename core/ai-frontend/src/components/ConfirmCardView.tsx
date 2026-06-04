import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { AiApi } from "@checkstack/ai-common";
import { extractErrorMessage } from "@checkstack/common";
import { ShieldAlert, Check, X } from "lucide-react";
import type { ConfirmCard } from "../lib/stream-parser";
import { DiffView } from "./DiffView";

/**
 * Renders a CONFIRM CARD for a mutate/destructive tool the model proposed. The
 * model never silently mutates: nothing happens until the operator clicks
 * Apply, which consumes the single-use proposal token via `applyTool`.
 *
 * After the operator applies OR declines, `onDecision` is fired so the page can
 * stream the model's acknowledgment of the outcome (the conversation continues
 * instead of dead-ending on "waiting for your confirmation").
 */
export function ConfirmCardView({
  card,
  onDecision,
}: {
  card: ConfirmCard;
  onDecision?: (decision: {
    token: string;
    decision: "apply" | "decline";
  }) => void;
}) {
  const ai = usePluginClient(AiApi);
  const [state, setState] = useState<"pending" | "applied" | "declined">(
    "pending",
  );
  const [error, setError] = useState<string | undefined>();

  const applyMutation = ai.applyTool.useMutation({
    onSuccess: () => {
      setState("applied");
      // Apply committed server-side; now have the model acknowledge it.
      onDecision?.({ token: card.token, decision: "apply" });
    },
    onError: (error_: unknown) =>
      setError(extractErrorMessage(error_, "Apply failed")),
  });

  const onDecline = () => {
    setState("declined");
    onDecision?.({ token: card.token, decision: "decline" });
  };

  const destructive = card.effect === "destructive";

  return (
    <Card className={destructive ? "border-destructive/50" : "border-primary/40"}>
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldAlert
          className={`w-4 h-4 ${destructive ? "text-destructive" : "text-primary"}`}
        />
        <CardTitle className="text-sm">
          Confirm: {card.toolName}
        </CardTitle>
        <Badge variant={destructive ? "destructive" : "secondary"}>
          {card.effect}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{card.summary}</p>
        {/* For an update we show the before -> after diff (what changes);
            otherwise the full ready-to-apply payload (what will be created). */}
        {card.diff && card.diff.length > 0 ? (
          <div className="max-h-72 overflow-auto rounded bg-muted p-2">
            <DiffView diff={card.diff} />
          </div>
        ) : (
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-48">
            {JSON.stringify(card.payload, null, 2)}
          </pre>
        )}
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}
        {state === "pending" ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={destructive ? "destructive" : "primary"}
              disabled={applyMutation.isPending}
              onClick={() => applyMutation.mutate({ token: card.token })}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              {applyMutation.isPending ? "Applying..." : "Apply"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={applyMutation.isPending}
              onClick={onDecline}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Decline
            </Button>
          </div>
        ) : (
          <p className="text-xs font-medium">
            {state === "applied" ? "Applied." : "Declined."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
