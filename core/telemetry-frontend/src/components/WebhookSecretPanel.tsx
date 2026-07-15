import { CopyableValue } from "@checkstack/ui";
import type { WebhookInfo } from "@checkstack/telemetry-common";

export interface WebhookSecretPanelProps {
  info: WebhookInfo;
}

/**
 * Reveals a webhook endpoint's path and its secret, shown exactly ONCE (the
 * backend keeps only the secret's hash). Used after creating a webhook-mode
 * source and after rotating its secret. The path is a plain copyable value; the
 * secret carries `CopyableValue`'s shown-once warning.
 */
export function WebhookSecretPanel({ info }: WebhookSecretPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-inset p-4">
      <CopyableValue value={info.path} label="Webhook URL" />
      <CopyableValue
        value={info.secret}
        label="Webhook secret"
        shownOnce
        warningMessage="Store this secret securely. It signs requests to the endpoint and will not be shown again."
      />
    </div>
  );
}
