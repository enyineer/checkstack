import React from "react";
import { AlertCircle } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@checkstack/ui";
import type { BlockingIssue } from "../editor/blocking-issues";

export interface SaveBlockersSummaryProps {
  /** Ordered list of everything blocking the Save button. */
  blockers: BlockingIssue[];
  /**
   * Navigate to / focus the surface that owns a blocker. Wired by the page to
   * focus the offending field or reveal the definition editor.
   */
  onResolve: (blocker: BlockingIssue) => void;
}

/**
 * Compact "N issue(s) blocking save" affordance shown next to the Save button
 * when the automation is invalid. Each row links to the offending field /
 * section so a greyed-out Save is never a dead end.
 *
 * Renders nothing when there are no blockers, so the page can drop it next to
 * Save unconditionally.
 */
export const SaveBlockersSummary: React.FC<SaveBlockersSummaryProps> = ({
  blockers,
  onResolve,
}) => {
  const [open, setOpen] = React.useState(false);
  if (blockers.length === 0) return null;

  const count = blockers.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-destructive/50 text-destructive hover:text-destructive"
        >
          <AlertCircle className="mr-1 h-4 w-4" />
          {count} {count === 1 ? "issue" : "issues"} blocking
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Fix these to save
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {blockers.map((blocker, index) => (
            <li key={`${blocker.message}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onResolve(blocker);
                }}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="break-words">{blocker.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
