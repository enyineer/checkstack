import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { File, Folder } from "lucide-react";
import {
  IDELayout,
  IDETreeNode,
  IDETreeSection,
  type ValidationIssue,
} from "../src/components/IDELayout";

const meta: Meta = {
  title: "Components/Layout/IDELayout",
};

export default meta;
type Story = StoryObj;

const issues: ValidationIssue[] = [
  { nodeId: "node-2", message: "URL is required" },
];

const Demo = () => {
  const [selected, setSelected] = useState("node-1");
  return (
    <IDELayout
      issues={issues}
      onIssueClick={setSelected}
      tree={
        <div className="py-2">
          <IDETreeSection label="Check items" />
          <IDETreeNode
            nodeId="node-1"
            label="api.checkstack.io"
            icon={File}
            selected={selected === "node-1"}
            onClick={() => setSelected("node-1")}
            issues={issues}
          />
          <IDETreeNode
            nodeId="node-2"
            label="db.primary"
            icon={File}
            selected={selected === "node-2"}
            onClick={() => setSelected("node-2")}
            issues={issues}
          />
          <IDETreeSection label="Permissions" />
          <IDETreeNode
            nodeId="node-3"
            label="readers"
            icon={Folder}
            selected={selected === "node-3"}
            onClick={() => setSelected("node-3")}
          />
        </div>
      }
      panel={
        <div className="p-6">
          <h3 className="font-semibold">Editing: {selected}</h3>
          <p className="text-sm text-muted-foreground mt-2">
            The right panel renders whatever editor is appropriate for the
            selected tree node.
          </p>
        </div>
      }
    />
  );
};

export const Default: Story = { render: () => <Demo /> };
