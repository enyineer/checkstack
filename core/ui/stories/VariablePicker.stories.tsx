import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  VariablePicker,
  type VariableNode,
} from "../src/components/VariablePicker";

const meta: Meta<typeof VariablePicker> = {
  title: "Components/Automation/VariablePicker",
  component: VariablePicker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Hierarchical picker — click the trigger button to open a tree of in-scope automation variables.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof VariablePicker>;

const sampleScope: VariableNode[] = [
  {
    path: "trigger",
    type: "object",
    description: "Trigger that fired this run.",
    children: [
      {
        path: "trigger.event",
        type: '"incident.created" | "incident.resolved"',
        description: "Discriminator.",
      },
      {
        path: "trigger.payload",
        type: "object",
        children: [
          { path: "trigger.payload.incidentId", type: "string" },
          {
            path: "trigger.payload.title",
            type: "string",
            conditionalOnTriggers: ["incident.created"],
          },
          {
            path: "trigger.payload.resolvedAt",
            type: "string",
            conditionalOnTriggers: ["incident.resolved"],
          },
        ],
      },
    ],
  },
  {
    path: "var",
    type: "object",
    description: "Operator-defined variables.",
    children: [{ path: "var.outer", type: "string" }],
  },
  {
    path: "artifact",
    type: "object",
    description: "Artifacts produced upstream.",
    children: [
      {
        path: "artifact.jira.issue",
        type: "object",
        children: [
          { path: "artifact.jira.issue.key", type: "string" },
          { path: "artifact.jira.issue.url", type: "string" },
        ],
      },
    ],
  },
];

const DefaultDemo = () => {
  const [inserted, setInserted] = useState<string | null>(null);
  return (
    <div className="p-12 flex flex-col items-start gap-4">
      <VariablePicker scope={sampleScope} onSelect={setInserted} />
      {inserted && (
        <p className="text-xs text-muted-foreground">
          Inserted: <code className="font-mono">{`{{${inserted}}}`}</code>
        </p>
      )}
    </div>
  );
};

export const Default: Story = {
  render: () => <DefaultDemo />,
};
