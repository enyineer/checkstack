import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MarkdownEditor } from "../src/components/MarkdownEditor";
import { Label } from "../src/components/Label";

const meta: Meta<typeof MarkdownEditor> = {
  title: "Components/Forms/MarkdownEditor",
  component: MarkdownEditor,
};

export default meta;
type Story = StoryObj<typeof MarkdownEditor>;

const SAMPLE = `We are **investigating** elevated error rates on the payments API.

- Checkout is affected
- Refunds are unaffected

Follow along in the [runbook](https://example.com/runbook).`;

/** Controlled wrapper - the editor never owns its own value. */
function Demo(props: {
  initial?: string;
  rows?: number;
  showToolbar?: boolean;
  label: string;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <div className="max-w-2xl space-y-2">
      <Label htmlFor="story-editor">{props.label}</Label>
      <MarkdownEditor
        id="story-editor"
        value={value}
        onChange={setValue}
        placeholder="Describe the status update..."
        rows={props.rows}
        showToolbar={props.showToolbar}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <Demo label="Update message" initial={SAMPLE} />,
};

/** Switch to the Preview tab to see the same render the timeline produces. */
export const Empty: Story = {
  render: () => <Demo label="Update message" />,
};

/** Toolbar off, for a field where formatting affordances would be noise. */
export const WithoutToolbar: Story = {
  render: () => (
    <Demo label="Description" initial={SAMPLE} showToolbar={false} />
  ),
};

/** Taller variant, for a long-form description field. */
export const Tall: Story = {
  render: () => <Demo label="Description" initial={SAMPLE} rows={10} />,
};
