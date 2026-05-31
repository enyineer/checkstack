import React from "react";
import { Plus, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@checkstack/ui";

/**
 * Shared building blocks for the editor's Home-Assistant-style "type
 * pickers" (add action / add trigger / add condition). Each picker opens a
 * dialog with a single search box and a grouped, searchable list of rows;
 * clicking a row creates the item and closes the dialog. The trigger and
 * condition pickers are single-list; the action picker layers tabs on top of
 * the same row + dialog shell.
 */

/**
 * A single picker row — icon, name, description, and a `+` affordance. Shared
 * by every picker so the rows look identical across actions / triggers /
 * conditions.
 */
export const PickerRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
}> = ({ icon, title, description, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-start gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/50"
  >
    <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">{title}</div>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    <Plus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
  </button>
);

/**
 * The "+ Add …" trigger button — outline, small, with a leading plus. Matches
 * the Actions "Add step" button so every list's add affordance is identical.
 */
export const PickerAddButton: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, disabled, onClick }) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    disabled={disabled}
    className="h-7 text-xs"
    onClick={onClick}
  >
    <Plus className="mr-1 h-3 w-3" />
    {label}
  </Button>
);

/**
 * Search box used at the top of every picker dialog. Auto-focuses on open so
 * the operator can type immediately.
 */
export const PickerSearchInput: React.FC<{
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}> = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="pl-9"
    />
  </div>
);

export interface PickerDialogShellProps {
  /** Label for the bottom "+ Add …" button (e.g. "Add trigger"). */
  addLabel: string;
  /** Title rendered in the dialog header. */
  title: string;
  /** Placeholder for the search box. */
  searchPlaceholder: string;
  disabled?: boolean;
  /**
   * Renders the dialog body given the current (lowercased, trimmed) query and a
   * `close` callback the body calls after creating an item.
   */
  children: (args: { query: string; close: () => void }) => React.ReactNode;
}

/**
 * Single-list picker shell: a bottom "+ Add …" button that opens a dialog with
 * a search box and a scrollable body. The body (a grouped list of
 * {@link PickerRow}s) is supplied by the caller, which receives the live query
 * and a `close` callback. Transient state resets on close so the dialog always
 * reopens clean.
 */
export const PickerDialogShell: React.FC<PickerDialogShellProps> = ({
  addLabel,
  title,
  searchPlaceholder,
  disabled,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <>
      <PickerAddButton
        label={addLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <PickerSearchInput
              value={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
            />
            <div className="max-h-[50vh] overflow-y-auto pr-1">
              {children({
                query: query.trim().toLowerCase(),
                close: () => setOpen(false),
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
