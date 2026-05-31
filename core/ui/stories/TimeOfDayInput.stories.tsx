import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TimeOfDayInput } from "../src/components/TimeOfDayInput";
import { Label } from "../src/components/Label";

const meta: Meta<typeof TimeOfDayInput> = {
  title: "Components/Inputs/TimeOfDayInput",
  component: TimeOfDayInput,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TimeOfDayInput>;

const Demo = ({ initial }: { initial?: string }) => {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div className="max-w-sm space-y-2">
      <Label>On-call window starts at</Label>
      <TimeOfDayInput value={value} onChange={setValue} />
      <pre className="text-xs text-muted-foreground">
        {JSON.stringify(value ?? null)}
      </pre>
    </div>
  );
};

export const Empty: Story = { render: () => <Demo /> };

export const Set: Story = { render: () => <Demo initial="22:00" /> };

export const Disabled: Story = {
  render: () => <TimeOfDayInput value="09:30" onChange={() => {}} disabled />,
};
