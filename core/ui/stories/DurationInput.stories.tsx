import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DurationInput,
  type DurationValue,
} from "../src/components/DurationInput";
import { Label } from "../src/components/Label";

const meta: Meta<typeof DurationInput> = {
  title: "Components/Inputs/DurationInput",
  component: DurationInput,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DurationInput>;

const Demo = ({
  initial,
  defaultUnit,
}: {
  initial?: DurationValue;
  defaultUnit?: "seconds" | "minutes" | "hours";
}) => {
  const [value, setValue] = useState<DurationValue | undefined>(initial);
  return (
    <div className="max-w-sm space-y-2">
      <Label>Fire only if state holds for</Label>
      <DurationInput
        value={value}
        onChange={setValue}
        defaultUnit={defaultUnit}
      />
      <pre className="text-xs text-muted-foreground">
        {JSON.stringify(value ?? null)}
      </pre>
    </div>
  );
};

export const Empty: Story = { render: () => <Demo /> };

export const Minutes: Story = {
  render: () => <Demo initial={{ minutes: 30 }} />,
};

export const Hours: Story = {
  render: () => <Demo initial={{ hours: 2 }} />,
};

export const SecondsDefault: Story = {
  render: () => <Demo defaultUnit="seconds" />,
};

export const Disabled: Story = {
  render: () => (
    <DurationInput value={{ minutes: 10 }} onChange={() => {}} disabled />
  ),
};
