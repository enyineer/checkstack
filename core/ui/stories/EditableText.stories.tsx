import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { EditableText } from "../src/components/EditableText";

const meta: Meta<typeof EditableText> = {
  title: "Components/Inputs/EditableText",
  component: EditableText,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof EditableText>;

const Demo = () => {
  const [value, setValue] = useState("My system");
  return (
    <div className="max-w-sm">
      <EditableText
        value={value}
        onSave={async (next) => {
          await new Promise((r) => setTimeout(r, 300));
          setValue(next);
        }}
      />
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
