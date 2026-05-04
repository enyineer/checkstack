import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DynamicForm,
  KeyValueEditor,
  type JsonSchema,
  type KeyValuePair,
} from "../src/components/DynamicForm";

const meta: Meta = {
  title: "Components/Forms/DynamicForm",
};

export default meta;
type Story = StoryObj;

const schema: JsonSchema = {
  type: "object",
  required: ["url", "method"],
  properties: {
    url: { type: "string", title: "URL", format: "uri", description: "Endpoint to probe" },
    method: {
      type: "string",
      title: "Method",
      enum: ["GET", "POST", "HEAD"],
      default: "GET",
    },
    timeoutMs: {
      type: "number",
      title: "Timeout (ms)",
      default: 5000,
      minimum: 100,
      maximum: 60_000,
    },
    followRedirects: {
      type: "boolean",
      title: "Follow redirects",
      default: true,
    },
    apiKey: {
      type: "string",
      title: "API key",
      "x-secret": true,
    },
  },
};

const Demo = () => {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [valid, setValid] = useState(false);
  return (
    <div className="max-w-xl space-y-4">
      <DynamicForm
        schema={schema}
        value={value}
        onChange={setValue}
        onValidChange={setValid}
      />
      <p className="text-xs text-muted-foreground">
        Valid: <strong>{String(valid)}</strong>
      </p>
      <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto">
        {JSON.stringify(value, undefined, 2)}
      </pre>
    </div>
  );
};

export const FromSchema: Story = { render: () => <Demo /> };

const KvDemo = () => {
  const [pairs, setPairs] = useState<KeyValuePair[]>([
    { key: "Authorization", value: "Bearer ***" },
    { key: "X-Trace-Id", value: "abc-123" },
  ]);
  return (
    <div className="max-w-xl">
      <KeyValueEditor id="headers" value={pairs} onChange={setPairs} />
    </div>
  );
};

export const KeyValue: Story = { render: () => <KvDemo /> };
