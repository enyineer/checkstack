import type { Meta, StoryObj } from "@storybook/react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { RowAction, RowActions } from "../src/components/RowActions";

const meta: Meta = {
  title: "Components/Data/RowActions",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <RowActions>
      <RowAction icon={Pencil} label="Edit" onClick={() => {}} />
      <RowAction icon={Trash2} label="Delete" tone="destructive" onClick={() => {}} />
    </RowActions>
  ),
};

export const WithDisabledAndTooltip: Story = {
  render: () => (
    <RowActions>
      <RowAction icon={RotateCcw} label="Regenerate secret" onClick={() => {}} />
      <RowAction
        icon={Pencil}
        label="Edit"
        disabled
        title="Managed by GitOps"
        onClick={() => {}}
      />
      <RowAction icon={Trash2} label="Delete" tone="destructive" onClick={() => {}} />
    </RowActions>
  ),
};
