import { useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type ValidationIssue,
} from "@checkstack/ui";

export interface SaveBlockersSummaryProps {
  /** Validation issues currently blocking the Save button. */
  issues: ValidationIssue[];
  /** Navigate to the tree node that owns an issue so the user can fix it. */
  onNavigate: (nodeId: string) => void;
}

/**
 * Compact "N issue(s) blocking save" affordance shown next to the Save button.
 * Reuses the IDE's existing `ValidationIssue` model and click-to-navigate
 * behavior so a disabled Save explains itself right where the user is acting,
 * not only in the status bar at the bottom of the editor.
 *
 * Renders nothing when there are no issues.
 */
export const SaveBlockersSummary = ({
  issues,
  onNavigate,
}: SaveBlockersSummaryProps) => {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;

  const count = issues.length;

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
          {issues.map((issue, index) => (
            <li key={`${issue.nodeId}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onNavigate(issue.nodeId);
                }}
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="break-words">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
