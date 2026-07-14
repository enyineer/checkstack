import { useEffect, useMemo, useReducer, useState } from "react";
import { useApi, usePluginClient, accessApiRef } from "@checkstack/frontend-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  FormError,
  Stepper,
  useStepper,
  useToast,
  toastError,
} from "@checkstack/ui";
import {
  TeamOwnershipPicker,
  teamCreateErrorMessage,
} from "@checkstack/auth-frontend";
import { ArrowLeft } from "lucide-react";
import {
  TelemetryApi,
  telemetryAccess,
  type SourceTypeDescriptor,
  type TelemetrySignal,
} from "@checkstack/telemetry-common";
import {
  buildCreatePayload,
  deriveInitialInterval,
  type SourceEditorValues,
} from "../lib/source-form.logic";
import {
  bindingsToArray,
  initialBindingSelection,
} from "../lib/binding-editor.logic";
import {
  initialWebhookPanelState,
  isWebhookPanelOpen,
  webhookPanelReducer,
} from "../lib/webhook-panel.logic";
import { BindingEditor } from "./BindingEditor";
import { SourceConfigFields } from "./SourceConfigFields";
import { SourceTypeCatalog } from "./SourceTypeCatalog";
import { WebhookSecretPanel } from "./WebhookSecretPanel";

export interface AddSourceDialogProps {
  /**
   * When opened from a stream section, the embedding signal + stream to preset
   * the matching binding. Omitted on the global Sources page, where the binding
   * editor starts fully unbound.
   */
  signal?: TelemetrySignal;
  streamId?: string;
  sourceTypes: SourceTypeDescriptor[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEPS = [
  { id: "type", title: "Source type" },
  { id: "config", title: "Configure" },
];

function emptyValues(): SourceEditorValues {
  return {
    name: "",
    description: "",
    config: {},
    intervalSeconds: null,
    satelliteId: null,
    bindings: {},
  };
}

/**
 * Two-step "Add source" dialog: pick a source type from the catalog, then
 * configure and create the instance. When opened from a stream section the
 * embedding `{signal, streamId}` preset the matching binding; a single-signal
 * type opened this way collapses to that preset with no extra interaction,
 * while multi-signal types (and the global Sources page) expose the full
 * per-signal binding editor. For webhook-mode types the endpoint path and
 * secret are revealed once on success.
 */
export function AddSourceDialog({
  signal,
  streamId,
  sourceTypes,
  open,
  onOpenChange,
}: AddSourceDialogProps) {
  const client = usePluginClient(TelemetryApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();
  const stepper = useStepper({ count: STEPS.length });
  const { goTo, reset: resetStep } = stepper;

  const [descriptor, setDescriptor] = useState<SourceTypeDescriptor | null>(
    null,
  );
  const [values, setValues] = useState<SourceEditorValues>(emptyValues);
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerTeamError, setOwnerTeamError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [webhook, dispatchWebhook] = useReducer(
    webhookPanelReducer,
    initialWebhookPanelState,
  );

  // A caller who holds the global manage rule may create a global (un-owned)
  // source; otherwise the picker requires one of their teams.
  const { allowed: allowGlobal } = accessApi.useAccess(telemetryAccess.manage);

  const createMutation = client.createSource.useGatedMutation({
    onSuccess: (source) => {
      if (source.webhook) {
        dispatchWebhook({ type: "reveal", info: source.webhook });
        toast.success(`Created ${source.name}`);
        return;
      }
      toast.success(`Created ${source.name}`);
      onOpenChange(false);
    },
    onError: (error) => {
      const inline = teamCreateErrorMessage(error);
      if (inline) {
        setOwnerTeamError(inline);
        return;
      }
      toastError(toast, "Failed to create source", error);
    },
  });

  // Reset everything whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setDescriptor(null);
      setValues(emptyValues());
      setOwnerTeamId(null);
      setOwnerTeamError(null);
      setFormError(null);
      dispatchWebhook({ type: "dismiss" });
      resetStep();
    }
  }, [open, resetStep]);

  const patchValues = (patch: Partial<SourceEditorValues>) =>
    setValues((prev) => ({ ...prev, ...patch }));

  const selectType = (next: SourceTypeDescriptor) => {
    setDescriptor(next);
    setValues({
      ...emptyValues(),
      intervalSeconds: deriveInitialInterval({ descriptor: next }),
      bindings: initialBindingSelection({
        descriptor: next,
        presetSignal: signal ?? null,
        presetStreamId: streamId ?? null,
      }),
    });
    setFormError(null);
    goTo(1);
  };

  // The binding editor is hidden only in the section fast path: a single-signal
  // type whose one signal is already preset to the embedding stream. Everything
  // else (multi-signal types, the global page, a type that does not emit the
  // section's signal) shows the full per-signal editor.
  const boundCount = descriptor
    ? bindingsToArray({ descriptor, selection: values.bindings }).length
    : 0;
  const showBindingEditor = descriptor
    ? !(descriptor.signals.length === 1 && boundCount === 1)
    : false;

  const handleCreate = () => {
    if (!descriptor) return;
    if (values.name.trim().length === 0) {
      setFormError("Name is required");
      return;
    }
    if (bindingsToArray({ descriptor, selection: values.bindings }).length === 0) {
      setFormError("Route at least one signal to a stream");
      return;
    }
    setFormError(null);
    setOwnerTeamError(null);
    createMutation.mutate(
      buildCreatePayload({
        descriptor,
        values,
        teamId: ownerTeamId,
      }),
    );
  };

  const revealed = isWebhookPanelOpen(webhook);
  const saving = createMutation.isPending;

  const title = useMemo(() => {
    if (revealed) return "Source created";
    return descriptor ? `Configure ${descriptor.displayName}` : "Add source";
  }, [revealed, descriptor]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {revealed
              ? "Point your webhook at this endpoint. The secret is shown once."
              : "A source ingests telemetry into this stream. Pick a type, then configure it."}
          </DialogDescription>
        </DialogHeader>

        {revealed && webhook.info ? (
          <div className="space-y-4">
            <WebhookSecretPanel info={webhook.info} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <Stepper steps={STEPS} activeStep={stepper.activeStep} />

            {stepper.activeStep === 0 && (
              <SourceTypeCatalog
                sourceTypes={sourceTypes}
                onSelect={selectType}
              />
            )}

            {stepper.activeStep === 1 && descriptor && (
              <div className="space-y-4">
                <SourceConfigFields
                  descriptor={descriptor}
                  values={values}
                  onChange={patchValues}
                />

                {showBindingEditor && (
                  <BindingEditor
                    descriptor={descriptor}
                    selection={values.bindings}
                    onChange={(bindings) => patchValues({ bindings })}
                    disabled={saving}
                  />
                )}

                <TeamOwnershipPicker
                  value={ownerTeamId}
                  onChange={(id) => {
                    setOwnerTeamId(id);
                    setOwnerTeamError(null);
                  }}
                  allowGlobal={allowGlobal}
                  error={ownerTeamError}
                />

                {formError && <FormError>{formError}</FormError>}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goTo(0)}
                    disabled={saving}
                  >
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreate}
                    disabled={saving}
                  >
                    {saving ? "Creating..." : "Create source"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
