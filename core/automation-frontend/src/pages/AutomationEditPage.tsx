import React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ChevronLeft,
  History as HistoryIcon,
  Play,
  Save,
  Workflow,
} from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AutomationApi,
  automationAccess,
  automationRoutes,
  type AutomationDefinition,
} from "@checkstack/automation-common";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  CodeEditor,
  LoadingSpinner,
  QueryErrorState,
  Alert,
  AlertTitle,
  AlertDescription,
  Toggle,
  useToast,
  useInitOnceForKey,
  useUnsavedChanges,
  ConfirmationModal,
  Tabs,
  TabPanel,
  toastError,
} from "@checkstack/ui";
import { resolveRoute } from "@checkstack/common";
import {
  GitOpsLockBanner,
  useProvenanceLock,
} from "@checkstack/gitops-frontend";
import { TeamOwnershipPicker, teamCreateErrorMessage } from "@checkstack/auth-frontend";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AutomationDefinitionEditor } from "../editor/AutomationDefinitionEditor";
import { assignDefaultIds } from "../editor/action-helpers";
import { assignDefaultTriggerIds } from "../editor/trigger-helpers";
import { computeYamlMarkers } from "../editor/yaml-markers";
import { partitionIssues } from "../editor/editor-validation";
import { AutomationGroupCombobox } from "../components/AutomationGroupCombobox";
import { RunAsServiceAccountPicker } from "../components/RunAsServiceAccountPicker";
import { SaveBlockersSummary } from "../components/SaveBlockersSummary";
import {
  summarizeBlockingIssues,
  type BlockingIssue,
} from "../editor/blocking-issues";

const STARTER_DEFINITION: AutomationDefinition = {
  name: "New Automation",
  // Start empty: the operator picks a trigger and adds actions via the Add
  // dialogs (the empty-state hints guide them), rather than starting from a
  // pre-filled trigger + action they then have to replace.
  triggers: [],
  conditions: [],
  actions: [],
  mode: "single",
  concurrency_scope: "automation",
  max_runs: 10,
};

type EditTab = "visual" | "yaml";

/**
 * Full editor for an automation. Visual ↔ YAML tab switcher; both tabs
 * read from and write to the same canonical `definition` state object.
 *
 *   - **Visual** tab renders `<AutomationDefinitionEditor>` from
 *     `src/editor/` — triggers + pre-run conditions + drag-to-reorder
 *     actions, each action card backed by the Phase 11 `ActionCard`
 *     primitive and the matching per-kind body (Provider, Choose,
 *     Parallel, Repeat, Variables, ConditionGuard, Stop,
 *     WaitForTrigger, Sequence, Delay). Inline templates use the
 *     Phase 11 `TemplateValueInput` + `VariablePicker`, fed by the
 *     `VariableScopeResolver`-driven `useVariableScope` hook so each
 *     field sees only what's actually in scope at its action position.
 *
 *   - **YAML** tab renders the same definition as a Monaco yaml
 *     editor. Round-trips losslessly via `yaml.parse` / `yaml.stringify`.
 *
 * The save flow is identical regardless of which tab is active: parse
 * → `validateDefinition` RPC → `createAutomation` or `updateAutomation`.
 * Switching tabs first commits the active tab's state into
 * `definition` (parsing YAML on YAML→Visual transitions), so neither
 * side ever wins by accident.
 */
const AutomationEditContent: React.FC = () => {
  const { automationId } = useParams<{ automationId: string }>();
  const [searchParams] = useSearchParams();
  const isNew = !automationId || automationId === "new";
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();

  // Surface gate: the caller may reach this create/edit page when they hold the
  // GLOBAL read rule OR any team-derived grant on the automation type
  // (create/manage). A team-scoped creator/manager holds no global rule but must
  // still open the full flow; the mutation controls below stay gated on the
  // per-instance manage grant (`canManageThisAutomation`) and the create
  // capability (`canCreate`), and the backend enforces `create`/`idParam`.
  const { allowed: canAccessSurface, loading: accessLoading } =
    accessApi.useSurfaceAccess(AutomationApi.contract.listAutomations);
  // allowGlobal: the GLOBAL manage rule means the caller may create a resource
  // not scoped to any team. This feeds the TeamOwnershipPicker only.
  const { allowed: hasGlobalManageAccess } = accessApi.useAccess(
    automationAccess.manage,
  );
  const allowGlobal = hasGlobalManageAccess;

  // Create + per-instance manage gates are FUSED into the create/update
  // mutations below (`useGatedMutation`), so the controls that call `mutate`
  // read their own authorization from the same object - the gate can't drift
  // from the call. See `createMutation` / `updateMutation`.

  // GitOps provenance lock: when this automation is declaratively managed,
  // disable manual edits + show a banner. `entityId` is the automation id
  // (the GitOps reconciler stores it in provenance). New (unsaved)
  // automations are never locked.
  const { isLocked, provenance } = useProvenanceLock({
    kind: "Automation",
    entityId: isNew ? undefined : automationId,
  });

  // `canManage` is derived from the fused mutation gates below (create for new,
  // update-idParam for existing) AND the GitOps lock - see after the mutations.

  const loadQuery = client.getAutomation.useQuery(
    { id: automationId ?? "" },
    { enabled: !isNew, gcTime: 0 },
  );

  // Top-level form state.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  // Empty string means "Ungrouped" — sent as `null` on save to clear it.
  const [group, setGroup] = React.useState("");
  // Service account (Application id) the automation runs as. Empty means
  // "not chosen yet" — save is blocked until one is selected.
  const [runAsApplicationId, setRunAsApplicationId] = React.useState("");
  const [statusEnabled, setStatusEnabled] = React.useState(true);
  // Owning team — create mode only. null means global (no team owner).
  const [ownerTeamId, setOwnerTeamId] = React.useState<string | null>(null);
  // Inline error for team-create failures (e.g. OWNER_TEAM_REQUIRED).
  const [ownerTeamError, setOwnerTeamError] = React.useState<string | null>(null);

  // Existing group values for the picker's "pick existing" suggestions.
  const groupsQuery = client.listAutomationGroups.useQuery();
  const groupSuggestions = groupsQuery.data?.groups ?? [];
  const [definition, setDefinition] =
    React.useState<AutomationDefinition>(STARTER_DEFINITION);
  const [yamlText, setYamlText] = React.useState<string>(() =>
    stringifyYaml(STARTER_DEFINITION),
  );
  const [tab, setTab] = React.useState<EditTab>("visual");
  const [validationErrors, setValidationErrors] = React.useState<
    Array<{ path: Array<string | number>; message: string }>
  >([]);

  // Unsaved-changes tracking. Flipped true by any user edit (see `markDirty`),
  // reset when the form is (re)seeded from a record/template and after a save.
  // Drives the shared `useUnsavedChanges` guard below.
  const [isDirty, setIsDirty] = React.useState(false);
  const markDirty = React.useCallback(() => setIsDirty(true), []);

  // Seed local form state from the loaded automation, once per record.
  // `useInitOnceForKey` seeds during render (not in an effect), so it survives
  // StrictMode's double-mount even when the query resolves from a warm cache on
  // reopen, and ignores background refetches of the same record so in-progress
  // edits are not clobbered. `isFetchedAfterMount` keeps it to genuinely fresh
  // data rather than a stale cache entry served instantly on mount.
  useInitOnceForKey(
    loadQuery.isFetchedAfterMount ? loadQuery.data : undefined,
    loadQuery.data?.id,
    (a) => {
      // Stored definitions (seeded defaults, GitOps, hand-written YAML) may
      // carry triggers/actions without an `id`. The runtime derives those ids
      // on the fly, but the editor must materialize them eagerly so they show
      // immediately rather than appearing blank until the field is focused.
      // Both helpers preserve existing ids and only fill blanks, so this is
      // idempotent and matches how STARTER_DEFINITION is seeded.
      const normalized: AutomationDefinition = {
        ...a.definition,
        triggers: assignDefaultTriggerIds(a.definition.triggers),
        actions: assignDefaultIds(a.definition.actions, new Set()),
      };
      setName(a.name);
      setDescription(a.description ?? "");
      setGroup(a.group ?? "");
      setRunAsApplicationId(a.runAs ?? "");
      setStatusEnabled(a.status === "enabled");
      setDefinition(normalized);
      setYamlText(stringifyYaml(normalized));
      // Seeding from the stored record is not a user edit.
      setIsDirty(false);
    },
  );

  // Template seeding (new automations only): `/automation/new/blank?template=<id>`
  // pre-fills the editor from a curated example template. The template's
  // `definition` seeds the canonical state once; the operator still picks a
  // `runAs` service account and saves. `enabled: false` on the query keeps it
  // off the wire for blank (no-template) and existing-automation editors.
  const templateId = isNew ? searchParams.get("template") : null;
  const templatesQuery = client.listAutomationTemplates.useQuery(undefined, {
    enabled: Boolean(templateId),
    gcTime: 0,
  });
  const selectedTemplate = templateId
    ? templatesQuery.data?.items.find((t) => t.id === templateId)
    : undefined;
  useInitOnceForKey(
    templatesQuery.isFetchedAfterMount ? selectedTemplate : undefined,
    selectedTemplate?.id,
    (template) => {
      const normalized: AutomationDefinition = {
        ...template.definition,
        triggers: assignDefaultTriggerIds(template.definition.triggers),
        actions: assignDefaultIds(template.definition.actions, new Set()),
      };
      setName(template.definition.name);
      setDescription(template.definition.description ?? "");
      setDefinition(normalized);
      setYamlText(stringifyYaml(normalized));
    },
  );

  // Keep the YAML mirror in sync with definition while the visual editor
  // is active — the YAML tab needs a non-stale starting point when the
  // operator switches over.
  // eslint-disable-next-line checkstack/no-state-seed-in-effect -- deliberate live mirror of the visual editor's `definition` into the YAML tab's starting text; gated on the visual tab so it never overwrites in-progress YAML edits, and `definition` is local state (the actual query seeds already use useInitOnceForKey).
  React.useEffect(() => {
    if (tab === "visual") {
      setYamlText(stringifyYaml(definition));
    }
  }, [definition, tab]);

  const switchTab = (next: EditTab) => {
    if (next === tab) return;
    if (tab === "yaml") {
      // Commit YAML into definition before switching to Visual.
      try {
        const parsed = parseYaml(yamlText) as AutomationDefinition;
        if (parsed && typeof parsed === "object") {
          setDefinition(parsed);
        }
      } catch (error) {
        // Don't switch tabs while YAML is unparseable — the operator
        // would silently lose their edits. The Monaco markers already
        // squiggle the syntax error in place.
        toastError(toast, "Cannot switch - YAML is invalid", error);
        return;
      }
    }
    setTab(next);
  };

  // Not gated: a sandboxed validation dry-run (typeScoped), not a resource
  // write - nothing to fuse a per-instance verdict onto.
  // eslint-disable-next-line checkstack/prefer-gated-mutation -- validation dry-run, not a gated write
  const validateMutation = client.validateDefinition.useMutation({
    onSuccess: (result) => {
      setValidationErrors(result.valid ? [] : result.errors);
    },
    onError: (error) => toastError(toast, "Failed to validate automation", error),
  });

  // Live validation — separate mutation instance from the save-path one
  // so its constant background runs don't flicker the Save button's
  // pending state. `mutateAsync` is stable across renders.
  const { mutateAsync: runLiveValidation } =
    // eslint-disable-next-line checkstack/prefer-gated-mutation -- validation dry-run, not a gated write
    client.validateDefinition.useMutation();

  // Re-validate (debounced) on every edit in either tab, so invalid
  // values / keys / ids surface as the operator types — not just on
  // save or tab-switch. A generation counter discards stale async
  // results that resolve after a newer edit.
  const liveValidateGenerationRef = React.useRef(0);
  React.useEffect(() => {
    const generation = ++liveValidateGenerationRef.current;
    const handle = setTimeout(() => {
      let candidate: AutomationDefinition;
      if (tab === "yaml") {
        try {
          candidate = parseYaml(yamlText) as AutomationDefinition;
        } catch {
          // Unparseable YAML — the syntax-error markers come from
          // `computeYamlMarkers` parsing the same text, so just clear
          // the (now-unmappable) semantic issues.
          if (generation === liveValidateGenerationRef.current) {
            setValidationErrors([]);
          }
          return;
        }
      } else {
        candidate = definition;
      }
      void runLiveValidation({ definition: candidate })
        .then((result) => {
          if (generation !== liveValidateGenerationRef.current) return;
          setValidationErrors(result.valid ? [] : result.errors);
        })
        .catch(() => {
          // Transient RPC/permission error — the save path surfaces a
          // toast if it matters; live validation stays quiet.
        });
    }, 400);
    return () => clearTimeout(handle);
  }, [tab, yamlText, definition, runLiveValidation]);

  // Gate-fused create: `createMutation.allowed` is the create capability derived
  // from `createAutomation`'s own contract - you cannot get `mutate` without it.
  const createMutation = client.createAutomation.useGatedMutation({
    onSuccess: (data) => {
      // Saved: clear the dirty flag, then redirect on the next tick so the
      // unsaved-changes guard has committed `isDirty = false` and doesn't
      // block the post-create navigation.
      setIsDirty(false);
      toast.success(`Created ${data.name}`);
      setTimeout(() => {
        navigate(
          resolveRoute(automationRoutes.routes.edit, { automationId: data.id }),
        );
      }, 0);
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create automation", error);
    },
  });

  // Gate-fused update: `updateMutation.allowed` is the per-instance manage grant
  // on THIS automation, derived from `updateAutomation`'s `idParam` contract and
  // the id passed as `gateInput` - the same id `mutate` will send.
  const updateMutation = client.updateAutomation.useGatedMutation({
    gateInput: !isNew && automationId ? { id: automationId } : undefined,
    onSuccess: (data) => {
      setIsDirty(false);
      toast.success(`Saved ${data.name}`);
    },
    onError: (error) => toastError(toast, "Failed to save automation", error),
  });

  // Effective edit permission, derived from the FUSED mutation gates (create for
  // new, per-instance update for existing) AND not GitOps-locked.
  const canManage =
    (isNew ? createMutation.allowed : updateMutation.allowed) && !isLocked;

  // Compound-gated: the "Run now" control is rendered only under `canManage`
  // (itself the fused update gate), so its enablement is already contract-derived.
  // eslint-disable-next-line checkstack/prefer-gated-mutation -- compound-gated by canManage (fused from updateAutomation)
  const manualRunMutation = client.manualRun.useMutation({
    onSuccess: (data) => {
      toast.success(`Manual run queued`);
      if (automationId) {
        navigate(
          resolveRoute(automationRoutes.routes.runDetail, {
            automationId,
            runId: data.runId,
          }),
        );
      }
    },
    onError: (error) => toastError(toast, "Failed to queue manual run", error),
  });

  /**
   * Resolve the canonical definition from whichever tab is active. The
   * Visual tab keeps `definition` live as the operator edits, so it's
   * the trivial case. The YAML tab keeps the parsed object in
   * `definition` only after a successful tab switch; on Save we
   * re-parse the YAML directly so a Save click without first switching
   * tabs still commits the latest YAML edits.
   */
  const commitActiveTab = (): AutomationDefinition | null => {
    if (tab === "visual") return definition;
    try {
      return parseYaml(yamlText) as AutomationDefinition;
    } catch (error) {
      toastError(toast, "Fix the YAML syntax error before saving", error);
      return null;
    }
  };

  const handleSave = async () => {
    setOwnerTeamError(null);
    const committed = commitActiveTab();
    if (!committed) return;

    // The top-level form `name`/`description` are the source of truth and
    // overwrite whatever the definition carried (e.g. the starter's "New
    // Automation"). Merge BEFORE validating so we validate exactly what we
    // submit — otherwise an empty name passes definition validation (which
    // sees the starter name) but is rejected at the create RPC's input
    // boundary with a generic toast.
    const merged: AutomationDefinition = {
      ...committed,
      name,
      description: description || undefined,
    };

    const validation = await validateMutation.mutateAsync({
      definition: merged,
    });
    if (!validation.valid) return;

    // Empty input = Ungrouped. On create we omit it; on update we send `null`
    // so an explicit clear round-trips (undefined would leave it unchanged).
    const trimmedGroup = group.trim();

    if (isNew) {
      createMutation.mutate({
        name,
        description: description || undefined,
        group: trimmedGroup || undefined,
        runAs: runAsApplicationId,
        status: statusEnabled ? "enabled" : "disabled",
        definition: merged,
        teamId: ownerTeamId ?? undefined,
      });
    } else if (automationId) {
      updateMutation.mutate({
        id: automationId,
        name,
        description: description || undefined,
        group: trimmedGroup || null,
        runAs: runAsApplicationId,
        status: statusEnabled ? "enabled" : "disabled",
        definition: merged,
      });
    }
  };

  const handleManualRun = () => {
    if (!automationId) return;
    const committed = commitActiveTab();
    if (!committed) return;
    const firstTrigger = committed.triggers[0];
    if (!firstTrigger) {
      toast.error("Automation has no triggers - add one before running.");
      return;
    }
    manualRunMutation.mutate({
      automationId,
      triggerId: firstTrigger.id,
      payload: {},
    });
  };

  const tabItems = [
    { id: "visual", label: "Visual" },
    { id: "yaml", label: "YAML" },
  ];

  // YAML tab: squiggle the offending nodes (syntax errors + mapped
  // validation issues) inline instead of listing them in a panel.
  const yamlMarkers = React.useMemo(
    () => computeYamlMarkers(yamlText, validationErrors),
    [yamlText, validationErrors],
  );

  // Visual tab: most issues attach to a specific card; anything that
  // can't (top-level fields) is shown as a slim fallback note.
  const unattributedIssues = React.useMemo(
    () => partitionIssues(validationErrors).other,
    [validationErrors],
  );

  // The top-level `name` lives outside `definition`, so the definition
  // validator never checks it — an empty name slipped through to the create
  // RPC, which rejected it at its input boundary with a generic
  // "Input validation failed" toast. Validate it here so the Name field can
  // surface the error and Save can be disabled instead.
  const nameError = name.trim().length === 0 ? "Name is required" : undefined;
  // A service account is required: the automation runs with its permissions,
  // so the backend rejects a save without one. Block save + hint inline.
  const runAsError =
    runAsApplicationId.trim().length === 0
      ? "A service account is required"
      : undefined;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const canSave =
    !nameError && !runAsError && validationErrors.length === 0 && !isSaving;

  // Explain WHY Save is disabled: a flat, ordered list of blockers shown in a
  // popover next to the button, each linking to the offending field/section.
  const blockers = React.useMemo(
    () =>
      summarizeBlockingIssues({
        nameError,
        runAsError,
        definitionIssues: validationErrors,
      }),
    [nameError, runAsError, validationErrors],
  );

  // Resolve a blocker: bring its surface into view and focus the field.
  // Definition issues attach to the visual editor (their inline markers live
  // there), so we ensure that tab is active.
  const handleResolveBlocker = React.useCallback((blocker: BlockingIssue) => {
    if (blocker.target.kind === "definition") {
      setTab("visual");
      return;
    }
    const elementId = blocker.target.field === "name" ? "name" : "runAs";
    const element = document.querySelector(`#${elementId}`);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: "center" });
      element.focus();
    }
  }, []);

  // Unsaved-changes guard: native prompt on tab close / refresh and an in-app
  // confirm on navigation while there are pending edits.
  const { isBlocked, confirmDiscard, cancelDiscard } = useUnsavedChanges({
    isDirty,
  });

  return (
    <PageLayout
      title={isNew ? "New automation" : name || "Edit automation"}
      subtitle={isNew ? "Wire a trigger to one or more actions" : undefined}
      icon={Workflow}
      loading={accessLoading || (!isNew && loadQuery.isLoading)}
      allowed={canAccessSurface && (isNew ? canManage : true)}
      actions={
        <div className="flex items-center gap-2">
          <Link to={resolveRoute(automationRoutes.routes.list)}>
            <Button variant="outline" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              All automations
            </Button>
          </Link>
          {!isNew && automationId && (
            <>
              <Link
                to={resolveRoute(automationRoutes.routes.runs, {
                  automationId,
                })}
              >
                <Button variant="outline" size="sm">
                  <HistoryIcon className="mr-1 h-4 w-4" />
                  Runs
                </Button>
              </Link>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualRun}
                  disabled={manualRunMutation.isPending}
                >
                  <Play className="mr-1 h-4 w-4" />
                  Run now
                </Button>
              )}
            </>
          )}
          {canManage && (
            <>
              <SaveBlockersSummary
                blockers={blockers}
                onResolve={handleResolveBlocker}
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!canSave || validateMutation.isPending}
              >
                <Save className="mr-1 h-4 w-4" />
                Save
              </Button>
            </>
          )}
        </div>
      }
    >
      {!isNew && loadQuery.isError ? (
        <QueryErrorState
          error={loadQuery.error}
          onRetry={() => loadQuery.refetch()}
        />
      ) : !isNew && loadQuery.isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-4">
          {isLocked && provenance && (
            <GitOpsLockBanner provenance={provenance} />
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  // Land focus in the first field when opening a fresh editor so
                  // keyboard-first users can type immediately.
                  autoFocus={isNew}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    markDirty();
                  }}
                  disabled={!canManage}
                  placeholder="Open Jira issue when incident fires"
                  aria-invalid={nameError ? true : undefined}
                  className={nameError ? "border-destructive" : undefined}
                />
                {nameError && (
                  <p className="text-xs text-destructive">{nameError}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    markDirty();
                  }}
                  disabled={!canManage}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="group">Group</Label>
                <AutomationGroupCombobox
                  id="group"
                  value={group}
                  onValueChange={(next) => {
                    setGroup(next);
                    markDirty();
                  }}
                  suggestions={groupSuggestions}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Organises the automations list into sections.
                </p>
              </div>
              <RunAsServiceAccountPicker
                value={runAsApplicationId}
                onValueChange={(next) => {
                  setRunAsApplicationId(next);
                  markDirty();
                }}
                disabled={!canManage}
                showError={!!runAsError}
              />
              {/* Owning team — shown only when creating a new automation */}
              {isNew && (
                <TeamOwnershipPicker
                  value={ownerTeamId}
                  onChange={(id) => {
                    setOwnerTeamId(id);
                    setOwnerTeamError(null);
                    markDirty();
                  }}
                  allowGlobal={allowGlobal}
                  disabled={!canManage}
                  error={ownerTeamError}
                />
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="enabled">Enabled</Label>
                <Toggle
                  checked={statusEnabled}
                  onCheckedChange={(next) => {
                    setStatusEnabled(next);
                    markDirty();
                  }}
                  disabled={!canManage}
                  aria-label="Enable automation"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mode">Concurrency mode</Label>
                <Select
                  value={definition.mode}
                  onValueChange={(value) => {
                    setDefinition({
                      ...definition,
                      mode: value as AutomationDefinition["mode"],
                    });
                    markDirty();
                  }}
                  disabled={!canManage}
                >
                  <SelectTrigger id="mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">single</SelectItem>
                    <SelectItem value="parallel">parallel</SelectItem>
                    <SelectItem value="queued">queued</SelectItem>
                    <SelectItem value="restart">restart</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="max_runs">Max concurrent runs</Label>
                <Input
                  id="max_runs"
                  type="number"
                  min={1}
                  max={1000}
                  value={definition.max_runs}
                  onChange={(e) => {
                    setDefinition({
                      ...definition,
                      max_runs: Math.max(1, Number(e.target.value)),
                    });
                    markDirty();
                  }}
                  disabled={!canManage}
                />
              </div>
            </CardContent>
          </Card>

          <div>
            <div className="mb-2">
              <Tabs
                items={tabItems}
                activeTab={tab}
                onTabChange={(id) => switchTab(id as EditTab)}
              />
            </div>
            <TabPanel id="visual" activeTab={tab}>
              {unattributedIssues.length > 0 && (
                <Alert variant="error" className="mb-2">
                  <AlertTitle>Definition issues</AlertTitle>
                  <AlertDescription>
                    <ul className="space-y-1 text-xs font-mono">
                      {unattributedIssues.map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {/* `AutomationDefinitionEditor` owns the `ValidationProvider`
                  (inside its registry provider) so it can merge these
                  structural issues with the live inline-script type issues it
                  computes. */}
              <AutomationDefinitionEditor
                value={definition}
                onChange={(next) => {
                  setDefinition(next);
                  markDirty();
                }}
                disabled={!canManage}
                automationId={isNew ? undefined : automationId}
                structuralIssues={validationErrors}
              />
            </TabPanel>
            <TabPanel id="yaml" activeTab={tab}>
              <Card>
                <CardContent className="p-0">
                  <CodeEditor
                    value={yamlText}
                    onChange={(next) => {
                      setYamlText(next);
                      markDirty();
                    }}
                    language="yaml"
                    minHeight="520px"
                    readOnly={!canManage}
                    markers={yamlMarkers}
                  />
                </CardContent>
              </Card>
            </TabPanel>
          </div>
          </div>
        </div>
      )}
      <ConfirmationModal
        isOpen={isBlocked}
        onClose={cancelDiscard}
        onConfirm={confirmDiscard}
        title="Discard unsaved changes?"
        message="You have unsaved changes to this automation. Leaving now will discard them."
        confirmText="Discard changes"
        cancelText="Keep editing"
        variant="warning"
      />
    </PageLayout>
  );
};

export const AutomationEditPage = wrapInSuspense(AutomationEditContent);
