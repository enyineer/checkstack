import { useState } from "react";
import {
  Link2,
  Link2Off,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Send,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  Button,
  Badge,
  DynamicForm,
  cn,
  DynamicIcon,
  MarkdownBlock,
  Spinner,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  CopyableValue,
  StatusPill,
  type LucideIconName,
} from "@checkstack/ui";
import {
  deriveTestErrorMessage,
  deriveTestRejectionMessage,
} from "./userChannelCard.logic";

/**
 * User channel data from getUserDeliveryChannels endpoint
 */
export interface UserDeliveryChannel {
  strategyId: string;
  displayName: string;
  description?: string;
  icon?: LucideIconName;
  contactResolution: {
    type: "auth-email" | "auth-provider" | "user-config" | "oauth-link";
  };
  enabled: boolean;
  isConfigured: boolean;
  linkedAt?: Date;
  userConfigSchema?: Record<string, unknown>;
  userConfig?: Record<string, unknown>;
  /** Markdown instructions for users (connection guides, etc.) */
  userInstructions?: string;
}

export interface UserChannelCardProps {
  channel: UserDeliveryChannel;
  onToggle: (strategyId: string, enabled: boolean) => Promise<void>;
  onConnect: (strategyId: string) => Promise<void>;
  onDisconnect: (strategyId: string) => Promise<void>;
  onSaveConfig: (
    strategyId: string,
    config: Record<string, unknown>
  ) => Promise<void>;
  onTest: (strategyId: string) => Promise<{ success: boolean; error?: string }>;
  saving?: boolean;
  connecting?: boolean;
  testing?: boolean;
}

/**
 * User card for managing their notification channel preferences.
 * Shows enable/disable, OAuth connect/disconnect, and user config form.
 */
export function UserChannelCard({
  channel,
  onToggle,
  onConnect,
  onDisconnect,
  onSaveConfig,
  onTest,
  saving,
  connecting,
  testing,
}: UserChannelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [userConfig, setUserConfig] = useState<Record<string, unknown>>(
    channel.userConfig ?? {}
  );
  const [localEnabled, setLocalEnabled] = useState(channel.enabled);
  const [configValid, setConfigValid] = useState(true); // Start true since existing config is valid
  // Holds the full error message from the last failed test so it can be shown
  // (and copied) inline. Toasts truncate to ~100 chars, which hid the actual
  // transport error; the operator needs the whole thing to diagnose.
  const [testError, setTestError] = useState<string | null>(null);

  const requiresOAuth = channel.contactResolution.type === "oauth-link";
  const requiresUserConfig = channel.contactResolution.type === "user-config";
  const isLinked = !!channel.linkedAt;
  const hasUserConfigSchema =
    channel.userConfigSchema &&
    Object.keys(channel.userConfigSchema).length > 0;

  // Determine if channel can be enabled
  const canEnable = () => {
    if (requiresOAuth && !isLinked) return false;
    if (requiresUserConfig && !channel.isConfigured) return false;
    return true;
  };

  const handleToggle = async () => {
    const newEnabled = !localEnabled;
    if (!canEnable() && newEnabled) {
      // Can't enable - missing requirements
      return;
    }
    setLocalEnabled(newEnabled);
    await onToggle(channel.strategyId, newEnabled);
  };

  const handleConnect = async () => {
    await onConnect(channel.strategyId);
  };

  const handleDisconnect = async () => {
    await onDisconnect(channel.strategyId);
    setLocalEnabled(false);
  };

  const handleSaveConfig = async () => {
    await onSaveConfig(channel.strategyId, userConfig);
  };

  const handleTest = async () => {
    // Clear any stale error so a retry starts from a clean slate. A passing
    // test is toasted by the page's mutation; the card only owns the failure.
    setTestError(null);
    try {
      const message = deriveTestErrorMessage(await onTest(channel.strategyId));
      if (message !== null) {
        setTestError(message);
      }
    } catch (error) {
      // A rejected mutation (transport / auth failure) never reaches the
      // success/error contract above - surface its message here too.
      setTestError(deriveTestRejectionMessage(error));
    }
  };

  // Get status badge. Connection state is a status signal, so it uses the
  // colorblind-safe status triad and is multi-encoded with a dot + label.
  const getStatusBadge = () => {
    if (requiresOAuth && !isLinked) {
      return <StatusPill tone="warn">Not Connected</StatusPill>;
    }
    if (requiresUserConfig && !channel.isConfigured) {
      return <StatusPill tone="warn">Setup Required</StatusPill>;
    }
    if (localEnabled) {
      return <StatusPill tone="ok">Active</StatusPill>;
    }
    return <Badge variant="outline">Disabled</Badge>;
  };

  // Left accent-stripe tone, agreeing with the status pill above: ok when
  // active + configured, warn when a connection / setup step is required,
  // and a neutral border otherwise (merely disabled).
  const accentStripe =
    (requiresOAuth && !isLinked) ||
    (requiresUserConfig && !channel.isConfigured)
      ? "bg-status-warn"
      : localEnabled && channel.isConfigured
        ? "bg-status-ok"
        : "bg-border";

  return (
    <Card className="group relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
      {/* Status accent stripe: connection state by position + hue. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accentStripe)}
        aria-hidden
      />
      {/* Header */}
      <div className="flex items-center justify-between p-4 pl-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-surface-inset p-2">
            <DynamicIcon
              name={channel.icon}
              className="h-5 w-5 text-muted-foreground"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{channel.displayName}</span>
              {getStatusBadge()}
            </div>
            {channel.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {channel.description}
              </p>
            )}
            {isLinked && channel.linkedAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Connected {new Date(channel.linkedAt).toLocaleDateString()}
              </p>
            )}
            {/* Warning for OAuth strategies about shared targets */}
            {requiresOAuth && isLinked && (
              <p className="text-xs text-warning mt-1">
                ⚠️ Avoid shared targets (group chats) - transactional messages
                (e.g., password resets) may also be sent here.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* OAuth Connect/Disconnect */}
          {requiresOAuth &&
            (isLinked ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDisconnect()}
                disabled={saving || connecting}
                className="text-destructive hover:text-destructive"
              >
                {connecting ? (
                  <Spinner size="sm" />
                ) : (
                  <Link2Off className="h-4 w-4 mr-1" />
                )}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleConnect()}
                disabled={saving || connecting}
              >
                {connecting ? (
                  <Spinner size="sm" />
                ) : (
                  <Link2 className="h-4 w-4 mr-1" />
                )}
                Connect
              </Button>
            ))}

          {/* Enable/Disable toggle */}
          {canEnable() && (
            <Button
              variant={localEnabled ? "primary" : "outline"}
              size="sm"
              onClick={() => void handleToggle()}
              disabled={saving}
              className="min-w-[90px]"
            >
              {localEnabled ? (
                <>
                  <Check className="h-4 w-4 mr-1" />
                  Enabled
                </>
              ) : (
                <>
                  <X className="h-4 w-4 mr-1" />
                  Disabled
                </>
              )}
            </Button>
          )}

          {/* Test notification button - only show when channel is configured */}
          {channel.isConfigured && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleTest()}
              disabled={testing || saving}
              title="Send test notification"
            >
              {testing ? (
                <Spinner size="sm" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Expand for user config */}
          {hasUserConfigSchema && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Test-notification failure: full, copyable error so operators can
          diagnose a misconfigured channel without opening the network console. */}
      {testError && (
        <div className="border-t p-4 pl-5">
          <Alert variant="error">
            <AlertIcon>
              <AlertCircle className="h-4 w-4" />
            </AlertIcon>
            <AlertContent>
              <div className="flex items-start justify-between gap-2">
                <AlertTitle>Test notification failed</AlertTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTestError(null)}
                  aria-label="Dismiss error"
                  className="-mr-1 -mt-1 h-6 w-6 shrink-0 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <AlertDescription>
                The channel could not deliver the test notification. Copy the
                error below when reporting the problem.
              </AlertDescription>
              <CopyableValue
                value={testError}
                label="Error message"
                className="pt-1"
              />
            </AlertContent>
          </Alert>
        </div>
      )}

      {/* User config form */}
      {expanded && hasUserConfigSchema && channel.userConfigSchema && (
        <div className="border-t p-4 bg-surface-inset space-y-4">
          {/* User instructions block */}
          {channel.userInstructions && (
            <div className="p-4 bg-surface-2 rounded-lg border border-border/50">
              <MarkdownBlock size="sm">
                {channel.userInstructions}
              </MarkdownBlock>
            </div>
          )}

          <DynamicForm
            schema={channel.userConfigSchema}
            value={userConfig}
            onChange={setUserConfig}
            onValidChange={setConfigValid}
          />
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void handleSaveConfig()}
              disabled={saving || !configValid}
              size="sm"
            >
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      )}

      {/* User instructions when not connected (for oauth-link channels) */}
      {!isLinked && channel.userInstructions && requiresOAuth && (
        <div className="border-t p-4 bg-surface-inset">
          <MarkdownBlock size="sm">{channel.userInstructions}</MarkdownBlock>
        </div>
      )}
    </Card>
  );
}
