import { useState } from "react";
import { Button, cn, StatusPill } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { AiApi } from "@checkstack/ai-common";
import { extractErrorMessage } from "@checkstack/common";
import { ShieldAlert, Check, X } from "lucide-react";
import type { ConfirmCard } from "../lib/stream-parser";
import { DiffView } from "./DiffView";
import {
  toolCardToneStyles,
  toolCardShell,
  toolCardInset,
  toolCardPill,
} from "./tool-card-styles";

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
  // A destructive proposal reads as "down" (a removal); a mutate/create
  // proposal reads as "warn" (a proposed-but-not-yet-applied change). Status is
  // encoded by accent-stripe position + hue + the pill, not by border alone.
  const tone = destructive ? "down" : "warn";
  const styles = toolCardToneStyles[tone];

  return (
    <div className={toolCardShell}>
      {/* Status accent stripe: status by position + hue, not color alone. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
        aria-hidden
      />
      <div className="space-y-3 pl-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <ShieldAlert className={cn("mt-0.5 h-4 w-4 shrink-0", styles.text)} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {card.summary}
              </p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {card.toolName}
              </p>
            </div>
          </div>
          <StatusPill tone={tone}>{card.effect}</StatusPill>
        </div>

        {/* For an update we show the before -> after diff (what changes);
            otherwise the full ready-to-apply payload (what will be created). */}
        <div className={cn(toolCardInset, "overflow-hidden")}>
          <p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          {card.diff && card.diff.length > 0 ? (
            <div className="max-h-72 overflow-auto p-2 pt-1">
              <DiffView diff={card.diff} />
            </div>
          ) : (
            <pre className="max-h-48 overflow-auto p-2 pt-1 text-xs">
              {JSON.stringify(card.payload, null, 2)}
            </pre>
          )}
        </div>

        {error ? <p className="text-xs text-status-down">{error}</p> : null}
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
          <span
            className={cn(
              toolCardPill,
              state === "applied"
                ? toolCardToneStyles.ok.pill
                : "bg-surface-inset text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                state === "applied"
                  ? toolCardToneStyles.ok.dot
                  : "bg-muted-foreground",
              )}
              aria-hidden
            />
            {state === "applied" ? "Applied." : "Declined."}
          </span>
        )}
      </div>
    </div>
  );
}
