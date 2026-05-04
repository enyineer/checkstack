import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  PluginConfigForm,
  type PluginOption,
} from "../src/components/PluginConfigForm";

const meta: Meta = {
  title: "Components/Forms/PluginConfigForm",
};

export default meta;
type Story = StoryObj;

const plugins: PluginOption[] = [
  {
    id: "http-probe",
    displayName: "HTTP Probe",
    description: "Probes a public HTTP endpoint and asserts a 2xx response.",
    configSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", title: "URL", format: "uri" },
        timeoutMs: { type: "number", title: "Timeout (ms)", default: 5000 },
      },
    },
  },
  {
    id: "tcp-probe",
    displayName: "TCP Probe",
    description: "Opens a TCP connection to verify the port is reachable.",
    configSchema: {
      type: "object",
      required: ["host", "port"],
      properties: {
        host: { type: "string", title: "Host" },
        port: { type: "number", title: "Port" },
      },
    },
  },
];

const Demo = () => {
  const [pluginId, setPluginId] = useState("http-probe");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  return (
    <div className="max-w-xl">
      <PluginConfigForm
        label="Strategy"
        plugins={plugins}
        selectedPluginId={pluginId}
        onPluginChange={(id) => {
          setPluginId(id);
          setConfig({});
        }}
        config={config}
        onConfigChange={setConfig}
      />
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
