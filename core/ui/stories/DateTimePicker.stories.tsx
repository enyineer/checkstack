import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DateTimePicker } from "../src/components/DateTimePicker";

const meta: Meta<typeof DateTimePicker> = {
  title: "Components/Inputs/DateTimePicker",
  component: DateTimePicker,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DateTimePicker>;

const Demo = () => {
  const [value, setValue] = useState<Date | undefined>(new Date());
  return (
    <div className="space-y-3 max-w-md">
      <DateTimePicker value={value} onChange={setValue} />
      <p className="text-xs text-muted-foreground">
        {value ? value.toISOString() : "no date"}
      </p>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
