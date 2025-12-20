import React, { useState } from "react";
import {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
  CreateHealthCheckConfiguration,
} from "@checkmate/healthcheck-common";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@checkmate/ui";
import { DynamicForm } from "./DynamicForm";

interface HealthCheckEditorProps {
  strategies: HealthCheckStrategyDto[];
  initialData?: HealthCheckConfiguration;
  onSave: (data: CreateHealthCheckConfiguration) => Promise<void>;
  onCancel: () => void;
}

export const HealthCheckEditor: React.FC<HealthCheckEditorProps> = ({
  strategies,
  initialData,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(initialData?.name || "");
  const [strategyId, setStrategyId] = useState(initialData?.strategyId || "");
  const [interval, setInterval] = useState(
    initialData?.intervalSeconds?.toString() || "60"
  );
  const [config, setConfig] = useState<Record<string, unknown>>(
    (initialData?.config as Record<string, unknown>) || {}
  );

  const [loading, setLoading] = useState(false);

  const selectedStrategy = strategies.find((s) => s.id === strategyId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSave({
        name,
        strategyId,
        intervalSeconds: Number.parseInt(interval, 10),
        config,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {initialData ? "Edit Health Check" : "Create Health Check"}
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSave}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="strategy">Strategy</Label>
            <Select
              value={strategyId}
              onValueChange={setStrategyId}
              disabled={!!initialData} // Changing strategy changes schema, tricky for edit
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a strategy" />
              </SelectTrigger>
              <SelectContent>
                {strategies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval">Interval (seconds)</Label>
            <Input
              id="interval"
              type="number"
              min="1"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              required
            />
          </div>

          {selectedStrategy ? (
            <DynamicForm
              schema={selectedStrategy.configSchema}
              value={config}
              onChange={setConfig}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a strategy to configure.
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
