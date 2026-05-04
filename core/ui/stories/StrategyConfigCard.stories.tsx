import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  StrategyConfigCard,
  type StrategyConfigCardData,
} from "../src/components/StrategyConfigCard";

const meta: Meta<typeof StrategyConfigCard> = {
  title: "Components/Forms/StrategyConfigCard",
  component: StrategyConfigCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StrategyConfigCard>;

const strategy: StrategyConfigCardData = {
  id: "http-probe",
  displayName: "HTTP Probe",
  description: "Probe a public HTTP endpoint and assert a 2xx response.",
  icon: "Globe",
  enabled: true,
};

const Demo = () => {
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({
    url: "https://example.com/health",
    timeoutMs: 5000,
  });
  return (
    <div className="max-w-2xl">
      <StrategyConfigCard
        strategy={{ ...strategy, enabled }}
        onToggle={async (_, next) => setEnabled(next)}
        configSections={[
          {
            id: "main",
            title: "Configuration",
            value: config,
            schema: {
              type: "object",
              required: ["url"],
              properties: {
                url: { type: "string", title: "URL", format: "uri" },
                timeoutMs: { type: "number", title: "Timeout (ms)", default: 5000 },
              },
            },
            onSave: async (next) => setConfig(next),
          },
        ]}
      />
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
