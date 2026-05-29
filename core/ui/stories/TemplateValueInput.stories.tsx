import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TemplateValueInput } from "../src/components/TemplateValueInput";
import type { TemplateProperty } from "../src/components/CodeEditor";

const meta: Meta<typeof TemplateValueInput> = {
  title: "Components/Automation/TemplateValueInput",
  component: TemplateValueInput,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Single-line input with `{{` template autocomplete. Type `{{` to open the picker.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TemplateValueInput>;

const sampleProperties: TemplateProperty[] = [
  { path: "trigger.event", type: "string", description: "Event id." },
  { path: "trigger.payload.incidentId", type: "string" },
  { path: "trigger.payload.title", type: "string" },
  { path: "trigger.payload.severity", type: '"low" | "high"' },
  { path: "var.outer", type: "string" },
  { path: "artifact.jira.issue.key", type: "string" },
];

const WithPropertiesDemo = () => {
  const [value, setValue] = useState("Title: ");
  return (
    <div className="w-96 p-4">
      <TemplateValueInput
        value={value}
        onChange={setValue}
        placeholder="Type {{ to insert a variable…"
        templateProperties={sampleProperties}
      />
    </div>
  );
};

const NoPropertiesDemo = () => {
  const [value, setValue] = useState("");
  return (
    <div className="w-96 p-4">
      <TemplateValueInput
        value={value}
        onChange={setValue}
        placeholder="No template autocomplete here"
      />
    </div>
  );
};

export const WithProperties: Story = {
  render: () => <WithPropertiesDemo />,
};

export const NoProperties: Story = {
  render: () => <NoPropertiesDemo />,
};
