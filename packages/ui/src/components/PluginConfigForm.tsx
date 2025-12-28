import React from "react";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DynamicForm,
} from "..";
import { JsonSchema } from "./DynamicForm";

export interface PluginOption {
  id: string;
  displayName: string;
  description?: string;
  configSchema: JsonSchema;
}

interface PluginConfigFormProps {
  label: string;
  plugins: PluginOption[];
  selectedPluginId: string;
  onPluginChange: (id: string) => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  disabled?: boolean;
}

export const PluginConfigForm: React.FC<PluginConfigFormProps> = ({
  label,
  plugins,
  selectedPluginId,
  onPluginChange,
  config,
  onConfigChange,
  disabled,
}) => {
  const selectedPlugin = plugins.find((p) => p.id === selectedPluginId);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="plugin-select">{label}</Label>
        <Select
          value={selectedPluginId}
          onValueChange={onPluginChange}
          disabled={disabled}
        >
          <SelectTrigger id="plugin-select">
            <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {plugins.map((plugin) => (
              <SelectItem key={plugin.id} value={plugin.id}>
                <div>
                  <div className="font-medium">{plugin.displayName}</div>
                  {plugin.description && (
                    <div className="text-xs text-muted-foreground">
                      {plugin.description}
                    </div>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPlugin && (
        <div className="space-y-4">
          <div className="pt-4 border-t border-gray-100">
            <h3 className="text-lg font-semibold">Configuration</h3>
            <p className="text-sm text-muted-foreground">
              Configure the settings for {selectedPlugin.displayName}
            </p>
          </div>

          <DynamicForm
            schema={selectedPlugin.configSchema}
            value={config}
            onChange={onConfigChange}
          />
        </div>
      )}
    </div>
  );
};
