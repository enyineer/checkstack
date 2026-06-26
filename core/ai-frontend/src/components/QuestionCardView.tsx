import { useState } from "react";
import { Button, Input } from "@checkstack/ui";
import type { QuestionCard } from "../lib/stream-parser";

/**
 * Renders a QUESTION CARD the model posed via `askOperator`: a short question
 * with clickable answer chips plus an optional free-text box. Clicking a chip
 * (or submitting free text) calls `onAnswer`, which the page sends as the
 * operator's next message - turning a plaintext "what should I use?" into a
 * one-click reply.
 */
export function QuestionCardView({
  card,
  onAnswer,
  disabled,
}: {
  card: QuestionCard;
  /** Send the operator's chosen/typed answer as their next message. */
  onAnswer: (value: string) => void;
  /** Disabled while a turn is streaming. */
  disabled?: boolean;
}) {
  const [freeText, setFreeText] = useState("");

  const submitFreeText = () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    setFreeText("");
    onAnswer(trimmed);
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-surface-2 p-3">
      <p className="text-sm font-medium">{card.question}</p>
      <div className="flex flex-wrap gap-2">
        {card.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onAnswer(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {card.allowFreeText ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitFreeText();
          }}
        >
          <Input
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="Or type an answer..."
            disabled={disabled}
          />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={disabled || !freeText.trim()}
          >
            Send
          </Button>
        </form>
      ) : null}
    </div>
  );
}
