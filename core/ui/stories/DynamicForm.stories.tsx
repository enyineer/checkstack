import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DynamicForm,
  KeyValueEditor,
  type JsonSchema,
  type KeyValuePair,
  type OptionsResolver,
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

// Array-of-objects where each row's dropdowns are dynamic AND a row's `value`
// options depend on the row's OWN `key` plus the top-level `metricName`. This
// exercises the row-scoped formValues merge: the `value` resolver reads both
// `formValues.metricName` (whole-form) and `formValues.key` (its own row).
//
// This story is a visual demo only - it makes no assertions. The row-scoping
// behaviour it shows (each row's `value` resolver is invoked with THAT row's
// own `key`, and an `x-depends-on` key change re-fetches only the edited row)
// is guarded by the rendering/interaction test
// `../src/components/DynamicForm/rowScopedOptions.test.tsx`.
const arrayOfDynamicObjectsSchema: JsonSchema = {
  type: "object",
  required: ["metricName"],
  properties: {
    metricName: {
      type: "string",
      title: "Metric",
      "x-options-resolver": "metricName",
      "x-searchable": true,
    },
    labelFilters: {
      type: "array",
      title: "Label filters",
      description: "Each row's value options depend on that row's key.",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            title: "Key",
            "x-options-resolver": "labelKey",
            "x-depends-on": ["metricName"],
          },
          value: {
            type: "string",
            title: "Value",
            "x-options-resolver": "labelValue",
            "x-depends-on": ["metricName", "key"],
          },
        },
      },
    },
  },
};

const arrayOfDynamicObjectsResolvers: Record<string, OptionsResolver> = {
  metricName: async () => [
    { value: "http_requests_total", label: "http_requests_total" },
    { value: "http_request_duration_seconds", label: "http_request_duration_seconds" },
  ],
  labelKey: async (formValues) => {
    const metric = String(formValues.metricName ?? "");
    if (!metric) return [];
    return [
      { value: "method", label: "method" },
      { value: "code", label: "code" },
    ];
  },
  // Reads its OWN ROW's `key` (row-scoped) plus the whole-form `metricName`.
  labelValue: async (formValues) => {
    const key = String(formValues.key ?? "");
    if (!key) return [];
    return [
      { value: `${key}=a`, label: `${key}=a` },
      { value: `${key}=b`, label: `${key}=b` },
    ];
  },
};

const ArrayOfDynamicObjectsDemo = () => {
  const [value, setValue] = useState<Record<string, unknown>>({});
  return (
    <div className="max-w-xl space-y-4">
      <DynamicForm
        schema={arrayOfDynamicObjectsSchema}
        value={value}
        onChange={setValue}
        optionsResolvers={arrayOfDynamicObjectsResolvers}
      />
      <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto">
        {JSON.stringify(value, undefined, 2)}
      </pre>
    </div>
  );
};

export const ArrayOfDynamicObjects: Story = {
  render: () => <ArrayOfDynamicObjectsDemo />,
};
