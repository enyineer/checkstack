import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "../utils";

/**
 * Allow a SAFE subset of raw HTML in rendered markdown so model output that uses
 * native disclosure widgets (`<details>` / `<summary>` for a foldable diff) and
 * other plain formatting renders as intended instead of leaking the literal
 * tags as text. `rehype-raw` parses the embedded HTML; `rehype-sanitize` then
 * strips anything unsafe (scripts, event handlers, `javascript:` URLs, ...) - its
 * default schema already allow-lists `details`/`summary` plus the usual markdown
 * elements, so the XSS surface stays closed even though chat content is
 * model-generated. Order matters: raw MUST run before sanitize.
 */
const rehypePlugins = [rehypeRaw, rehypeSanitize];

/** Shared `<details>`/`<summary>` renderers: a styled, click-to-expand fold. */
const disclosureComponents: Pick<Components, "details" | "summary"> = {
  details: ({ children }) => (
    <details className="my-2 rounded-md border border-border bg-muted/40 px-3 py-2 [&[open]>summary]:mb-2">
      {children}
    </details>
  ),
  summary: ({ children }) => (
    <summary className="cursor-pointer select-none font-medium text-foreground marker:text-muted-foreground">
      {children}
    </summary>
  ),
};

export interface MarkdownProps {
  /** The markdown content to render */
  children: string;
  /** Additional CSS classes for the container */
  className?: string;
  /** Size variant affecting text size */
  size?: "sm" | "base" | "lg";
}

/**
 * Styled markdown renderer using Tailwind.
 *
 * Renders markdown content with consistent styling that matches
 * the application's design system.
 *
 * @example
 * ```tsx
 * <Markdown>**Bold** and *italic* text</Markdown>
 * <Markdown size="sm">Small text with [links](url)</Markdown>
 * ```
 */
export function Markdown({
  children,
  className,
  size = "base",
}: MarkdownProps) {
  const sizeClasses = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
  };

  const components: Components = {
    // Paragraphs - no extra margin for inline use
    p: ({ children }) => <span>{children}</span>,

    // Bold text
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),

    // Italic text
    em: ({ children }) => <em className="italic">{children}</em>,

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Inline code
    code: ({ children }) => (
      <code className="px-1 py-0.5 rounded bg-muted font-mono text-[0.9em]">
        {children}
      </code>
    ),

    // Strikethrough
    del: ({ children }) => (
      <del className="line-through text-muted-foreground">{children}</del>
    ),

    // Collapsible disclosure (e.g. a model-emitted "view diff" fold)
    ...disclosureComponents,
  };

  return (
    <span className={cn(sizeClasses[size], className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}

export interface MarkdownBlockProps extends MarkdownProps {
  /** Whether to show as a prose block with proper spacing */
  prose?: boolean;
}

/**
 * Styled markdown block renderer for longer content.
 *
 * Unlike `Markdown`, this renders full blocks with proper paragraph
 * spacing, headers, lists, and other block-level elements.
 *
 * @example
 * ```tsx
 * <MarkdownBlock>
 *   # Heading
 *
 *   Paragraph with **bold** text.
 *
 *   - List item 1
 *   - List item 2
 * </MarkdownBlock>
 * ```
 */
export function MarkdownBlock({
  children,
  className,
  size = "base",
  prose = true,
}: MarkdownBlockProps) {
  const sizeClasses = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-lg",
  };

  const components: Components = {
    // Paragraphs with proper spacing
    p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,

    // Headers
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mb-4 text-foreground">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-semibold mb-3 text-foreground">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mb-2 text-foreground">{children}</h3>
    ),

    // Bold text
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),

    // Italic text
    em: ({ children }) => <em className="italic">{children}</em>,

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
    ),
    li: ({ children }) => <li>{children}</li>,

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-muted pl-4 italic text-muted-foreground mb-4">
        {children}
      </blockquote>
    ),

    // Code blocks
    pre: ({ children }) => (
      <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-4 font-mono text-sm">
        {children}
      </pre>
    ),
    code: ({ children, className }) => {
      // Check if this is a code block (has language class)
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return <code>{children}</code>;
      }
      return (
        <code className="px-1 py-0.5 rounded bg-muted font-mono text-[0.9em]">
          {children}
        </code>
      );
    },

    // Horizontal rule
    hr: () => <hr className="border-border my-6" />,

    // Strikethrough
    del: ({ children }) => (
      <del className="line-through text-muted-foreground">{children}</del>
    ),

    // GFM tables (enabled via remark-gfm). Styled to the design tokens; the
    // wrapper scrolls horizontally so a wide table never overflows its bubble.
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
    th: ({ children }) => (
      <th className="border border-border px-2 py-1 text-left font-semibold text-foreground">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border px-2 py-1 align-top">{children}</td>
    ),

    // Collapsible disclosure (e.g. a model-emitted "view diff" fold)
    ...disclosureComponents,
  };

  return (
    <div
      className={cn(
        sizeClasses[size],
        prose && "prose prose-neutral dark:prose-invert max-w-none",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
