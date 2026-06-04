import { useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@checkstack/ui";
import type { FieldDiff } from "../lib/stream-parser";
import { SideBySideDiff } from "./SideBySideDiff";

/**
 * Format a diff value as text for the side-by-side view. Strings render as-is (so
 * a script keeps its line breaks); objects/arrays are pretty-printed multi-line
 * JSON. A missing side (added or removed field) becomes an empty document so the
 * other column shows the whole value as added/removed.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** The list of per-field side-by-side diffs (shared by the inline + popout view). */
function DiffBody({ diff }: { diff: FieldDiff[] }) {
  return (
    <div className="space-y-3">
      {diff.map((entry) => (
        <div key={entry.path} className="space-y-1">
          <div className="break-all font-mono text-xs font-medium text-foreground">
            {entry.path}
          </div>
          <SideBySideDiff
            before={formatValue(entry.before)}
            after={formatValue(entry.after)}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Render a before -> after field diff so the operator always sees exactly what an
 * update changes, on both the confirm card (approve mode) and the applied card
 * (auto mode). Each changed field renders a GitHub-style split diff (see
 * {@link SideBySideDiff}). A small "Expand" control pops the full diff into a
 * large dialog, since the inline chat bubble is narrow.
 */
export function DiffView({ diff }: { diff: FieldDiff[] }) {
  const [expanded, setExpanded] = useState(false);
  if (diff.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Expand
        </Button>
      </div>
      <DiffBody diff={diff} />
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          size="full"
          className="flex max-h-[85dvh] flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>Proposed changes</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto pr-1">
            <DiffBody diff={diff} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
