import { CopyableValue } from "@checkstack/ui";
import type {
  PushInfo,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
import { PushSnippetsPanel } from "./PushSnippetsPanel";

export interface PushSecretPanelProps {
  info: PushInfo;
  /** Signals the instance emits; drives the OTLP snippet endpoint keys. */
  signals: TelemetrySignal[];
}

/**
 * Reveals a push source's bearer token, shown exactly ONCE (the backend keeps
 * only the token's hash). Used after creating a push-mode source and after
 * rotating its token. The token carries `CopyableValue`'s shown-once warning;
 * the snippets below bake it in so they are ready to paste immediately.
 */
export function PushSecretPanel({ info, signals }: PushSecretPanelProps) {
  return (
    <div className="space-y-3">
      <CopyableValue
        value={info.token}
        label="Source token"
        shownOnce
        warningMessage="Store this token securely. It authenticates telemetry pushed to this source and will not be shown again."
      />
      <PushSnippetsPanel
        endpoints={info.endpoints}
        signals={signals}
        token={info.token}
      />
    </div>
  );
}
