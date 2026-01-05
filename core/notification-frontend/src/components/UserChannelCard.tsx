import { useState } from "react";
import {
  Link2,
  Link2Off,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Card,
  Button,
  Badge,
  DynamicForm,
  cn,
  DynamicIcon,
  MarkdownBlock,
} from "@checkmate/ui";

/**
 * User channel data from getUserDeliveryChannels endpoint
 */
export interface UserDeliveryChannel {
  strategyId: string;
  displayName: string;
  description?: string;
  icon?: string;
  contactResolution: {
    type:
      | "auth-email"
      | "auth-provider"
      | "user-config"
      | "oauth-link"
      | "custom";
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
  saving?: boolean;
  connecting?: boolean;
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
  saving,
  connecting,
}: UserChannelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [userConfig, setUserConfig] = useState<Record<string, unknown>>(
    channel.userConfig ?? {}
  );
  const [localEnabled, setLocalEnabled] = useState(channel.enabled);

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

  // Get status badge
  const getStatusBadge = () => {
    if (requiresOAuth && !isLinked) {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-600">
          Not Connected
        </Badge>
      );
    }
    if (requiresUserConfig && !channel.isConfigured) {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-600">
          Setup Required
        </Badge>
      );
    }
    if (localEnabled) {
      return (
        <Badge variant="secondary" className="text-green-600 border-green-600">
          Active
        </Badge>
      );
    }
    return <Badge variant="outline">Disabled</Badge>;
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        localEnabled && channel.isConfigured ? "border-green-500/30" : ""
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <DynamicIcon
            name={channel.icon}
            className="h-5 w-5 text-muted-foreground"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{channel.displayName}</span>
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
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ Avoid shared targets (group chats) — transactional messages
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
                  <Loader2 className="h-4 w-4 animate-spin" />
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
                  <Loader2 className="h-4 w-4 animate-spin" />
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

      {/* User config form */}
      {expanded && hasUserConfigSchema && channel.userConfigSchema && (
        <div className="border-t p-4 bg-muted/30 space-y-4">
          {/* User instructions block */}
          {channel.userInstructions && (
            <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
              <MarkdownBlock size="sm">
                {channel.userInstructions}
              </MarkdownBlock>
            </div>
          )}

          <DynamicForm
            schema={channel.userConfigSchema}
            value={userConfig}
            onChange={setUserConfig}
          />
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void handleSaveConfig()}
              disabled={saving}
              size="sm"
            >
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      )}

      {/* User instructions when not connected (for custom/oauth-link channels) */}
      {!isLinked &&
        channel.userInstructions &&
        (requiresOAuth || channel.contactResolution.type === "custom") && (
          <div className="border-t p-4 bg-muted/30">
            <MarkdownBlock size="sm">{channel.userInstructions}</MarkdownBlock>
          </div>
        )}
    </Card>
  );
}
