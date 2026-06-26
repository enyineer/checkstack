import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import { CatalogApi } from "@checkstack/catalog-common";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  toastError,
  toastSuccess,
  useStepper,
  useToast,
  type StepperStep,
} from "@checkstack/ui";
import { Globe, Layers, Server } from "lucide-react";
import { HealthCheckApi } from "../api";
import {
  DEFAULT_INTERVAL_SECONDS,
  buildHttpCheckConfiguration,
  resolveCheckName,
} from "./FirstCheckWizard.logic";

/**
 * Steps of the first-check wizard. The 1-1 onboarding path: choose or name a
 * system, point an HTTP check at a URL, review, and create the check + the
 * assignment in one go.
 */
const WIZARD_STEPS: StepperStep[] = [
  { id: "system", title: "System", description: "What you are monitoring" },
  { id: "check", title: "Health check", description: "The URL to probe" },
  { id: "review", title: "Review", description: "Create and start" },
];

/** Whether the check attaches to a brand-new system or an existing one. */
type SystemMode = "new" | "existing";

export interface FirstCheckWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a check is successfully created + assigned. */
  onCreated?: () => void;
}

/**
 * A guided "create a check" flow. It creates an HTTP health check and the
 * assignment between it and a system - either a brand-new system (the first-run
 * case) or an existing one (onboarding into an established instance) - in one
 * confirmation, so an operator goes straight to a running check without learning
 * the strategy picker, the editor, and the assignment screen first.
 *
 * It deliberately covers only the common 1-1 HTTP case. Power flows (other
 * strategies, multiple collectors, per-environment fan-out) stay in the full
 * editor.
 */
export function FirstCheckWizard({
  open,
  onOpenChange,
  onCreated,
}: FirstCheckWizardProps) {
  const toast = useToast();
  const catalogClient = usePluginClient(CatalogApi);
  const healthCheckClient = usePluginClient(HealthCheckApi);
  const stepper = useStepper({ count: WIZARD_STEPS.length });

  const [systemMode, setSystemMode] = useState<SystemMode>("new");
  const [systemName, setSystemName] = useState("");
  const [existingSystemId, setExistingSystemId] = useState("");
  const [url, setUrl] = useState("");
  const [checkName, setCheckName] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(
    DEFAULT_INTERVAL_SECONDS,
  );

  // Only fetched while the wizard is open (and really only needed for the
  // "existing system" branch).
  const systemsQuery = catalogClient.getSystems.useQuery({}, { enabled: open });
  const systems = systemsQuery.data?.systems ?? [];

  const createSystemMutation = catalogClient.createSystem.useMutation();
  const createAndAssignMutation = healthCheckClient.createAndAssign.useMutation();
  const isCreating =
    createSystemMutation.isPending || createAndAssignMutation.isPending;

  const trimmedSystemName = systemName.trim();
  const trimmedUrl = url.trim();
  const selectedSystem = systems.find((s) => s.id === existingSystemId);
  const targetSystemName =
    systemMode === "new" ? trimmedSystemName : (selectedSystem?.name ?? "");
  const effectiveCheckName = resolveCheckName({
    checkName,
    systemName: targetSystemName,
  });

  const reset = () => {
    setSystemMode("new");
    setSystemName("");
    setExistingSystemId("");
    setUrl("");
    setCheckName("");
    setIntervalSeconds(DEFAULT_INTERVAL_SECONDS);
    stepper.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canAdvanceFromSystem =
    systemMode === "new"
      ? trimmedSystemName.length > 0
      : existingSystemId.length > 0;
  const canAdvanceFromCheck = trimmedUrl.length > 0;

  const handleCreate = async () => {
    try {
      // Resolve the target system: an existing one as picked, or a freshly
      // created one. createAndAssign is atomic on the healthcheck side; for a
      // new system the createSystem call precedes it.
      let systemId: string;
      let systemLabel: string;
      if (systemMode === "existing") {
        systemId = existingSystemId;
        systemLabel = selectedSystem?.name ?? "the system";
      } else {
        const system = await createSystemMutation.mutateAsync({
          name: trimmedSystemName,
        });
        systemId = system.id;
        systemLabel = system.name;
      }

      await createAndAssignMutation.mutateAsync({
        systemId,
        enabled: true,
        configuration: buildHttpCheckConfiguration({
          url,
          checkName,
          systemName: targetSystemName,
          intervalSeconds,
          collectorId: crypto.randomUUID(),
        }),
      });
      toastSuccess(
        toast,
        `Created "${effectiveCheckName}" and started monitoring ${systemLabel}`,
      );
      onCreated?.();
      handleOpenChange(false);
    } catch (error) {
      toastError(toast, "Could not create the health check", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create a health check</DialogTitle>
          <DialogDescription>
            Pick a system, point a check at a URL, and we will create and start
            monitoring it for you.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Stepper
            steps={WIZARD_STEPS}
            activeStep={stepper.activeStep}
            onStepSelect={stepper.goTo}
          />
        </div>

        <div className="min-h-[15rem] space-y-4 py-2">
          {stepper.activeStep === 0 && (
            <div className="space-y-4">
              <div className="inline-flex rounded-md border border-input p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={systemMode === "new" ? "primary" : "ghost"}
                  onClick={() => setSystemMode("new")}
                >
                  New system
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={systemMode === "existing" ? "primary" : "ghost"}
                  onClick={() => setSystemMode("existing")}
                >
                  Existing system
                </Button>
              </div>

              {systemMode === "new" ? (
                <div className="space-y-2">
                  <Label htmlFor="wizard-system-name">System name</Label>
                  <Input
                    id="wizard-system-name"
                    autoFocus
                    placeholder="e.g. Payments API"
                    value={systemName}
                    onChange={(event) => setSystemName(event.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    A system is the thing you are monitoring. Its health, SLOs,
                    and incidents all hang off it.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="wizard-existing-system">System</Label>
                  <Select
                    value={existingSystemId}
                    onValueChange={setExistingSystemId}
                  >
                    <SelectTrigger id="wizard-existing-system">
                      <SelectValue
                        placeholder={
                          systemsQuery.isLoading
                            ? "Loading systems..."
                            : "Select a system"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {systems.map((system) => (
                        <SelectItem key={system.id} value={system.id}>
                          {system.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!systemsQuery.isLoading && systems.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No systems yet. Switch to <strong>New system</strong> to
                      create your first one.
                    </p>
                  )}
                </div>
              )}

              <Alert variant="info">
                <AlertIcon>
                  <Layers className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>Need prod and staging?</AlertTitle>
                  <AlertDescription>
                    Do not create one system per stage. Use one system and attach{" "}
                    <a
                      href={docsPath(APP_DOC_SLUGS.environments)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      Environments
                    </a>{" "}
                    to it - a single check then runs once per environment.
                  </AlertDescription>
                </AlertContent>
              </Alert>
            </div>
          )}

          {stepper.activeStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wizard-url">URL to monitor</Label>
                <Input
                  id="wizard-url"
                  autoFocus
                  placeholder="https://api.example.com/healthz"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  We send an HTTP request and expect a 200 response. You can add
                  more assertions later in the editor.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="wizard-check-name">Check name</Label>
                  <Input
                    id="wizard-check-name"
                    placeholder={
                      targetSystemName
                        ? `${targetSystemName} reachability`
                        : "e.g. API reachability"
                    }
                    value={checkName}
                    onChange={(event) => setCheckName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wizard-interval">Interval (seconds)</Label>
                  <Input
                    id="wizard-interval"
                    type="number"
                    min={1}
                    value={intervalSeconds}
                    onChange={(event) =>
                      setIntervalSeconds(
                        Math.max(1, Number(event.target.value) || 0),
                      )
                    }
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                This creates a simple HTTP{" "}
                <a
                  href={docsPath(APP_DOC_SLUGS.healthChecks)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  health check
                </a>{" "}
                that passes when the URL returns HTTP 200. For other strategies
                (TCP, database, script), multiple collectors, or custom
                assertions, use the{" "}
                <strong className="font-medium text-foreground">
                  Create Check
                </strong>{" "}
                button instead.
              </p>
            </div>
          )}

          {stepper.activeStep === 2 && (
            <div className="space-y-4">
              <dl className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <Server className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <dt className="text-muted-foreground">
                      System {systemMode === "new" ? "(new)" : "(existing)"}
                    </dt>
                    <dd className="font-medium">{targetSystemName}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Globe className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <dt className="text-muted-foreground">
                      {effectiveCheckName}
                    </dt>
                    <dd className="font-medium break-all">{trimmedUrl}</dd>
                    <dd className="text-muted-foreground">
                      HTTP, every {intervalSeconds}s, expecting a 200 response
                    </dd>
                  </div>
                </div>
              </dl>
              <Alert variant="info">
                <AlertIcon>
                  <Layers className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>What happens next</AlertTitle>
                  <AlertDescription>
                    Creating this assigns the check to the system and starts it
                    immediately. The first result appears within a few seconds.
                  </AlertDescription>
                </AlertContent>
              </Alert>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={stepper.back}
            disabled={stepper.isFirst || isCreating}
          >
            Back
          </Button>
          {stepper.isLast ? (
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={
                isCreating || !canAdvanceFromSystem || !canAdvanceFromCheck
              }
            >
              {isCreating ? "Creating..." : "Create and start"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={stepper.next}
              disabled={
                stepper.activeStep === 0
                  ? !canAdvanceFromSystem
                  : !canAdvanceFromCheck
              }
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
