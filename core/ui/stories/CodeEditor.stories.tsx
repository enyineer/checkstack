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
  minHeight = "280px",
}: {
  language: "json" | "yaml" | "javascript" | "typescript" | "shell";
  initial: string;
  minHeight?: string;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <CodeEditor
      value={value}
      onChange={setValue}
      language={language}
      minHeight={minHeight}
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

/**
 * The top-right "Expand editor" affordance opens the same editor in a large
 * full-screen overlay. The inline editor here is deliberately short so the
 * value of expanding a long script is obvious; both editors share the same
 * value, so edits made in the overlay persist after closing it.
 */
export const Popout: Story = {
  render: () => (
    <Demo
      language="typescript"
      minHeight="120px"
      initial={`// A longer script - click the expand icon (top-right) to edit it in a
// comfortable full-screen overlay. Edits sync back to the inline editor.
import { setTimeout as sleep } from "node:timers/promises";

export default async function run({ context }) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(context.url);
    if (res.ok) {
      return { ok: true, attempt };
    }
    await sleep(1000 * attempt);
  }
  return { ok: false };
}`}
    />
  ),
};

/** Shell scripts get a "Edit script - Shell" overlay title. */
export const Shell: Story = {
  render: () => (
    <Demo
      language="shell"
      minHeight="120px"
      initial={`#!/usr/bin/env bash
set -euo pipefail

curl -fsS "$TARGET_URL" > /dev/null && echo "up" || echo "down"`}
    />
  ),
};
