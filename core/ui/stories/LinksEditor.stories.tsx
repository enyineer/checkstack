import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LinksEditor, type HotLink } from "../src/components/LinksEditor";

const meta: Meta = {
  title: "Components/Inputs/LinksEditor",
};

export default meta;
type Story = StoryObj;

const Demo = ({
  canManage,
  hideTitle,
}: {
  canManage: boolean;
  hideTitle?: boolean;
}) => {
  const [links, setLinks] = useState<HotLink[]>([
    { id: "1", label: "Runbook", url: "https://example.com/runbook" },
    { id: "2", label: null, url: "https://example.com/dashboards/api" },
  ]);
  return (
    <div className="max-w-md">
      <LinksEditor
        links={links}
        canManage={canManage}
        hideTitle={hideTitle}
        onAdd={({ label, url }) => {
          setLinks((prev) => [
            ...prev,
            { id: String(prev.length + 1), label: label ?? null, url },
          ]);
        }}
        onRemove={(link) => {
          setLinks((prev) => prev.filter((l) => l.id !== link.id));
        }}
      />
    </div>
  );
};

export const Editable: Story = { render: () => <Demo canManage /> };
export const ReadOnly: Story = { render: () => <Demo canManage={false} /> };
/** For hosts (e.g. a "Manage links" dialog) whose own title names the surface. */
export const HiddenTitle: Story = {
  render: () => <Demo canManage hideTitle />,
};
