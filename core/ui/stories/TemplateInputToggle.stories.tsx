import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TemplateInputToggle } from "../src/components/TemplateInputToggle";
import { Input } from "../src/components/Input";

const meta: Meta<typeof TemplateInputToggle> = {
  title: "Components/Automation/TemplateInputToggle",
  component: TemplateInputToggle,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          'Wraps a typed input with an "fx" button. Click it to switch into template mode and back.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TemplateInputToggle>;

const NumberFieldDemo = () => {
  const [value, setValue] = useState("30");
  return (
    <div className="w-96 p-4">
      <TemplateInputToggle
        value={value}
        onChange={setValue}
        renderTyped={({ disabled }) => (
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
          />
        )}
        templateProperties={[
          { path: "trigger.payload.timeoutSeconds", type: "number" },
          { path: "var.delay", type: "number" },
        ]}
        templatePlaceholder="{{ trigger.payload.timeoutSeconds }}"
      />
    </div>
  );
};

const StartsInTemplateModeDemo = () => {
  const [value, setValue] = useState("{{ trigger.payload.timeoutSeconds }}");
  return (
    <div className="w-96 p-4">
      <TemplateInputToggle
        value={value}
        onChange={setValue}
        renderTyped={({ disabled }) => (
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
          />
        )}
        templateProperties={[
          { path: "trigger.payload.timeoutSeconds", type: "number" },
        ]}
      />
    </div>
  );
};

export const NumberField: Story = {
  render: () => <NumberFieldDemo />,
};

export const StartsInTemplateMode: Story = {
  render: () => <StartsInTemplateModeDemo />,
};
