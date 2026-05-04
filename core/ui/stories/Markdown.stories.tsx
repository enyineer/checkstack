import type { Meta, StoryObj } from "@storybook/react";
import { Markdown, MarkdownBlock } from "../src/components/Markdown";

const meta: Meta = {
  title: "Components/Display/Markdown",
};

export default meta;
type Story = StoryObj;

export const Inline: Story = {
  render: () => (
    <p>
      <Markdown>
        {"Build **fast**, ship **safe**. See the [docs](https://example.com)."}
      </Markdown>
    </p>
  ),
};

export const Block: Story = {
  render: () => (
    <MarkdownBlock>
      {`# Health checks

A *health check* probes a system and asserts an outcome.

- HTTP probes
- TCP probes
- Custom strategies

Read more in the [strategies guide](https://example.com).`}
    </MarkdownBlock>
  ),
};
