import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CodeEditor } from "../src/components/CodeEditor";

const meta: Meta<typeof CodeEditor> = {
  title: "Components/Inputs/CodeEditor",
  component: CodeEditor,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CodeEditor>;

const Demo = ({
  language,
  initial,
}: {
  language: "json" | "yaml" | "javascript";
  initial: string;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <CodeEditor
      value={value}
      onChange={setValue}
      language={language}
      minHeight="280px"
    />
  );
};

export const Json: Story = {
  render: () => (
    <Demo
      language="json"
      initial={`{
  "url": "https://api.example.com/health",
  "timeoutMs": 5000
}`}
    />
  ),
};

export const Yaml: Story = {
  render: () => (
    <Demo
      language="yaml"
      initial={`url: https://api.example.com/health
timeoutMs: 5000
assertions:
  - status: 200`}
    />
  ),
};

export const JavaScript: Story = {
  render: () => (
    <Demo
      language="javascript"
      initial={`// Custom assertion
export default async function check({ fetch }) {
  const res = await fetch("https://example.com");
  return res.status === 200;
}`}
    />
  ),
};
