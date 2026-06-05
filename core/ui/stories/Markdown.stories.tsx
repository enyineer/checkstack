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

// GFM tables (and strikethrough / autolinks) render via remark-gfm. The
// assistant frequently summarizes a draft as a table, so this must render as a
// real table, not a collapsed line of pipes.
export const Table: Story = {
  render: () => (
    <MarkdownBlock>
      {`Here's the draft:

| Field | Value |
|---|---|
| URL | https://example.com/status |
| Method | GET |
| Assertion | statusCode = 200 |
| Interval | 60s |
| Timeout | 10s |

~~old value~~ replaced.`}
    </MarkdownBlock>
  ),
};

// The assistant sometimes folds a long diff behind a native <details> disclosure.
// Raw HTML is parsed (rehype-raw) and sanitized (rehype-sanitize) so the
// collapsible renders as a click-to-expand widget instead of leaking the literal
// tags as text. Click the summary to expand.
export const Disclosure: Story = {
  render: () => (
    <MarkdownBlock>
      {`Here are the planned changes - please confirm:

<details>
<summary>📝 View diff</summary>

**Inline-Script:**

\`\`\`diff
- success: load < 0.6
+ success: load < (cpus().length * 0.6)
\`\`\`

</details>`}
    </MarkdownBlock>
  ),
};

// Sanitization closes the XSS surface: a script tag / event handler in model
// output is stripped, so only the safe text survives. This must render the bold
// text WITHOUT executing or showing any script.
export const SanitizesUnsafeHtml: Story = {
  render: () => (
    <MarkdownBlock>
      {`Safe **bold** text.<script>window.__pwned = true</script><img src=x onerror="window.__pwned = true">`}
    </MarkdownBlock>
  ),
};
