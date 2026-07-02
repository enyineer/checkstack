/** @jsxImportSource @opentui/react */
import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { PrInfo } from "../pr-preview/gh-prs.ts";
import { ACCENT } from "../theme.ts";

/**
 * Keyboard-driven multi-select of open PRs. Up/Down move the cursor, Space
 * toggles, Enter confirms the selection. Opentui's built-in `<select>` is
 * single-choice, so this small list implements multi-select directly.
 */
export function PrMultiSelect({
  prs,
  onSubmit,
}: {
  prs: readonly PrInfo[];
  onSubmit: (selected: PrInfo[]) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useKeyboard((key) => {
    switch (key.name) {
      case "up": {
        setCursor((c) => Math.max(0, c - 1));
        break;
      }
      case "down": {
        setCursor((c) => Math.min(prs.length - 1, c + 1));
        break;
      }
      case "space": {
        setSelected((prev) => {
          const next = new Set(prev);
          const num = prs[cursor]?.number;
          if (num === undefined) return prev;
          if (next.has(num)) next.delete(num);
          else next.add(num);
          return next;
        });
        break;
      }
      case "return": {
        onSubmit(prs.filter((pr) => selected.has(pr.number)));
        break;
      }
    }
  });

  if (prs.length === 0) {
    return <text fg="gray">No open PRs found.</text>;
  }

  return (
    <box flexDirection="column">
      {prs.map((pr, index) => {
        const active = index === cursor;
        const checked = selected.has(pr.number);
        const draft = pr.isDraft ? " (draft)" : "";
        return (
          <text key={pr.number} fg={active ? ACCENT : undefined}>
            {`${active ? "›" : " "} [${checked ? "x" : " "}] #${pr.number} ${pr.title}${draft}`}
          </text>
        );
      })}
    </box>
  );
}
