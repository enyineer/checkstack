import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/Select";

const meta: Meta = {
  title: "Components/Inputs/Select",
};

export default meta;
type Story = StoryObj;

const Demo = () => {
  const [value, setValue] = useState("");
  return (
    <div className="max-w-xs">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Pick an environment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="prod">Production</SelectItem>
          <SelectItem value="staging">Staging</SelectItem>
          <SelectItem value="dev">Development</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
