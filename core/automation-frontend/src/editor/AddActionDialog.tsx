import React from "react";
import { Plus, Search, Zap } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DynamicIcon,
  Input,
  TabPanel,
  Tabs,
} from "@checkstack/ui";
import { ACTION_KIND_META, type ActionKind } from "./action-helpers";
import { useAutomationRegistry } from "./registry-context";

/**
 * Building blocks shown in the "Blocks" tab — every action kind except the
 * generic provider `action`. Concrete provider actions are chosen directly
 * from the "Actions" tab (which presets the step's `action`), so the kind is
 * always decided up front rather than swapped on an existing step.
 */
const BLOCK_KINDS: ActionKind[] = [
  "choose",
  "parallel",
  "repeat",
  "sequence",
  "condition",
  "delay",
  "stop",
  "variables",
  "wait_for_trigger",
  "wait_until",
];

const TAB_ITEMS = [
  { id: "actions", label: "Actions" },
  { id: "blocks", label: "Blocks" },
];

/** Shared row used by both tabs — icon, name, description, and a `+` affordance. */
const PickerRow: React.FC<{
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

export interface AddActionDialogProps {
  /** Insert a building-block step of the given kind. */
  onAddKind: (kind: ActionKind) => void;
  /** Insert a provider-action step with its `action` preset to this id. */
  onAddAction: (qualifiedId: string) => void;
  disabled?: boolean;
}

/**
 * Home-Assistant-style step picker. The operator decides the step's type up
 * front: pick a concrete provider action (grouped by category) from the
 * "Actions" tab, or a structural building block from the "Blocks" tab. A
 * single search filters whichever tab is active.
 */
export const AddActionDialog: React.FC<AddActionDialogProps> = ({
  onAddKind,
  onAddAction,
  disabled,
}) => {
  const { actions } = useAutomationRegistry();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState("actions");
  const [query, setQuery] = React.useState("");

  // Reset transient state whenever the dialog closes so it reopens clean.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setTab("actions");
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  const filteredActions = React.useMemo(() => {
    if (!q) return actions;
    return actions.filter(
      (action) =>
        action.displayName.toLowerCase().includes(q) ||
        action.qualifiedId.toLowerCase().includes(q) ||
        action.description?.toLowerCase().includes(q) ||
        action.category.toLowerCase().includes(q),
    );
  }, [actions, q]);

  const groupedActions = React.useMemo(() => {
    const groups = new Map<string, typeof actions>();
    for (const action of filteredActions) {
      const list = groups.get(action.category) ?? [];
      list.push(action);
      groups.set(action.category, list);
    }
    return [...groups.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }, [filteredActions]);

  const filteredBlocks = React.useMemo(() => {
    if (!q) return BLOCK_KINDS;
    return BLOCK_KINDS.filter((kind) => {
      const meta = ACTION_KIND_META[kind];
      return (
        meta.label.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q)
      );
    });
  }, [q]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add step
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Add action</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search actions and blocks…"
                className="pl-9"
              />
            </div>

            <Tabs items={TAB_ITEMS} activeTab={tab} onTabChange={setTab} />

            <div className="max-h-[50vh] overflow-y-auto pr-1">
              <TabPanel id="actions" activeTab={tab}>
                {groupedActions.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs italic text-muted-foreground">
                    No matching actions. Looking for choose / repeat / delay?
                    Check the Blocks tab.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {groupedActions.map(([category, list]) => (
                      <div key={category} className="space-y-1">
                        <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {category}
                        </p>
                        {list.map((action) => (
                          <PickerRow
                            key={action.qualifiedId}
                            icon={<Zap className="h-4 w-4" />}
                            title={action.displayName}
                            description={action.description}
                            onClick={() => {
                              onAddAction(action.qualifiedId);
                              setOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </TabPanel>

              <TabPanel id="blocks" activeTab={tab}>
                {filteredBlocks.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs italic text-muted-foreground">
                    No matching blocks.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredBlocks.map((kind) => {
                      const meta = ACTION_KIND_META[kind];
                      return (
                        <PickerRow
                          key={kind}
                          icon={<DynamicIcon name={meta.icon} className="h-4 w-4" />}
                          title={meta.label}
                          description={meta.description}
                          onClick={() => {
                            onAddKind(kind);
                            setOpen(false);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </TabPanel>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
