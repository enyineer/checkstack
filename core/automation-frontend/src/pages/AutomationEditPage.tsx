import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
  Tabs,
  TabPanel,
} from "@checkstack/ui";
import { extractErrorMessage, resolveRoute } from "@checkstack/common";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { AutomationDefinitionEditor } from "../editor/AutomationDefinitionEditor";
import { assignDefaultIds } from "../editor/action-helpers";
import { assignDefaultTriggerIds } from "../editor/trigger-helpers";
import { computeYamlMarkers } from "../editor/yaml-markers";
import {
  ValidationProvider,
  partitionIssues,
} from "../editor/editor-validation";

const STARTER_DEFINITION: AutomationDefinition = {
  name: "New Automation",
  // Seed the starter trigger's id the same way actions are seeded, so it is
  // shown (and referenceable as `trigger.id`) immediately.
  triggers: assignDefaultTriggerIds([{ event: "incident.created" }]),
  conditions: [],
  // Run the seeded starter action through the same default-id assignment the
  // "Add step" path uses, so its `id` is filled in (and shown) immediately
  // rather than appearing blank until the field is focused.
  actions: assignDefaultIds(
    [
      {
        action: "automation.log",
        config: {
          message: "Incident {{ trigger.payload.title }} fired",
          level: "info",
        },
        enabled: true,
        continue_on_error: false,
      },
    ],
    new Set(),
  ),
  mode: "single",
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
  const isNew = !automationId || automationId === "new";
  const client = usePluginClient(AutomationApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const navigate = useNavigate();

  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    automationAccess.read,
  );
  const { allowed: canManage } = accessApi.useAccess(automationAccess.manage);

  const loadQuery = client.getAutomation.useQuery(
    { id: automationId ?? "" },
    { enabled: !isNew, gcTime: 0 },
  );

  // Top-level form state.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [statusEnabled, setStatusEnabled] = React.useState(true);
  const [definition, setDefinition] =
    React.useState<AutomationDefinition>(STARTER_DEFINITION);
  const [yamlText, setYamlText] = React.useState<string>(() =>
    stringifyYaml(STARTER_DEFINITION),
  );
  const [tab, setTab] = React.useState<EditTab>("visual");
  const [validationErrors, setValidationErrors] = React.useState<
    Array<{ path: Array<string | number>; message: string }>
  >([]);

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
      setName(a.name);
      setDescription(a.description ?? "");
      setStatusEnabled(a.status === "enabled");
      setDefinition(a.definition);
      setYamlText(stringifyYaml(a.definition));
    },
  );

  // Keep the YAML mirror in sync with definition while the visual editor
  // is active — the YAML tab needs a non-stale starting point when the
  // operator switches over.
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
        toast.error(`Cannot switch — YAML is invalid: ${extractErrorMessage(error)}`);
        return;
      }
    }
    setTab(next);
  };

  const validateMutation = client.validateDefinition.useMutation({
    onSuccess: (result) => {
      setValidationErrors(result.valid ? [] : result.errors);
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

  // Live validation — separate mutation instance from the save-path one
  // so its constant background runs don't flicker the Save button's
  // pending state. `mutateAsync` is stable across renders.
  const { mutateAsync: runLiveValidation } =
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

  const createMutation = client.createAutomation.useMutation({
    onSuccess: (data) => {
      toast.success(`Created ${data.name}`);
      navigate(
        resolveRoute(automationRoutes.routes.edit, { automationId: data.id }),
      );
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

  const updateMutation = client.updateAutomation.useMutation({
    onSuccess: (data) => {
      toast.success(`Saved ${data.name}`);
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  });

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
    onError: (error) => toast.error(extractErrorMessage(error)),
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
      toast.error(`Fix the YAML syntax error before saving: ${extractErrorMessage(error)}`);
      return null;
    }
  };

  const handleSave = async () => {
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

    if (isNew) {
      createMutation.mutate({
        name,
        description: description || undefined,
        status: statusEnabled ? "enabled" : "disabled",
        definition: merged,
      });
    } else if (automationId) {
      updateMutation.mutate({
        id: automationId,
        name,
        description: description || undefined,
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
      toast.error("Automation has no triggers — add one before running.");
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
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const canSave = !nameError && validationErrors.length === 0 && !isSaving;

  return (
    <PageLayout
      title={isNew ? "New automation" : name || "Edit automation"}
      subtitle={isNew ? "Wire a trigger to one or more actions" : undefined}
      icon={Workflow}
      loading={accessLoading || (!isNew && loadQuery.isLoading)}
      allowed={canRead && (isNew ? canManage : true)}
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
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || validateMutation.isPending}
            >
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
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
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canManage}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="enabled">Enabled</Label>
                <Toggle
                  checked={statusEnabled}
                  onCheckedChange={setStatusEnabled}
                  disabled={!canManage}
                  aria-label="Enable automation"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mode">Concurrency mode</Label>
                <Select
                  value={definition.mode}
                  onValueChange={(value) =>
                    setDefinition({
                      ...definition,
                      mode: value as AutomationDefinition["mode"],
                    })
                  }
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
                  onChange={(e) =>
                    setDefinition({
                      ...definition,
                      max_runs: Math.max(1, Number(e.target.value)),
                    })
                  }
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
              <ValidationProvider issues={validationErrors}>
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
                <AutomationDefinitionEditor
                  value={definition}
                  onChange={setDefinition}
                  disabled={!canManage}
                />
              </ValidationProvider>
            </TabPanel>
            <TabPanel id="yaml" activeTab={tab}>
              <Card>
                <CardContent className="p-0">
                  <CodeEditor
                    value={yamlText}
                    onChange={setYamlText}
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
      )}
    </PageLayout>
  );
};

export const AutomationEditPage = wrapInSuspense(AutomationEditContent);
