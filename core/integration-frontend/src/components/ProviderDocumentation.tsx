import { useState } from "react";
import { Button, Badge, MarkdownBlock } from "@checkstack/ui";
import { ChevronDown, ChevronUp, ExternalLink, FileJson } from "lucide-react";
import type { IntegrationProviderInfo } from "@checkstack/integration-common";

interface ProviderDocumentationProps {
  provider: IntegrationProviderInfo;
}

/** Small uppercase eyebrow label that heads each documentation section. */
const SectionLabel = ({ children }: { children: string }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
);

/**
 * Displays provider documentation in a collapsible section.
 * Shows setup guide, example payload, headers, and external docs link.
 */
export const ProviderDocumentation = ({
  provider,
}: ProviderDocumentationProps) => {
  const { documentation } = provider;
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render if no documentation defined
  if (!documentation) {
    return <></>;
  }

  // Check if there's any actual content to display
  const hasContent =
    documentation.setupGuide ??
    documentation.examplePayload ??
    documentation.headers?.length ??
    documentation.externalDocsUrl;

  if (!hasContent) {
    return <></>;
  }

  return (
    <div className="overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 transition-colors hover:bg-surface-inset"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset text-primary">
            <FileJson className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold">Documentation</span>
          <Badge variant="secondary" className="text-xs">
            {isExpanded ? "Hide" : "Show"}
          </Badge>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-4 border-t border-border/60 p-[var(--d-pad)]">
          {/* Setup Guide */}
          {documentation.setupGuide && (
            <div>
              <SectionLabel>Setup Guide</SectionLabel>
              <div className="rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset p-3">
                <MarkdownBlock size="sm">
                  {documentation.setupGuide}
                </MarkdownBlock>
              </div>
            </div>
          )}

          {/* Example Payload */}
          {documentation.examplePayload && (
            <div>
              <SectionLabel>Example Payload</SectionLabel>
              <div className="rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset p-3">
                <pre className="overflow-x-auto rounded-md border border-border/60 bg-surface p-3 text-xs">
                  <code>{documentation.examplePayload}</code>
                </pre>
              </div>
            </div>
          )}

          {/* Headers */}
          {documentation.headers && documentation.headers.length > 0 && (
            <div>
              <SectionLabel>HTTP Headers</SectionLabel>
              <div className="overflow-hidden rounded-[calc(var(--d-card-r)-4px)] border border-border/60">
                <div className="hidden sm:block">
                  <dl className="divide-y divide-border/60">
                    {documentation.headers.map((header) => (
                      <div
                        key={header.name}
                        className="grid grid-cols-3 gap-3 px-3 py-2"
                      >
                        <dt className="font-mono text-sm text-foreground">
                          {header.name}
                        </dt>
                        <dd className="col-span-2 text-sm text-muted-foreground">
                          {header.description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="flex flex-col divide-y divide-border/60 sm:hidden">
                  {documentation.headers.map((header) => (
                    <div key={header.name} className="px-3 py-2">
                      <div className="break-all font-mono text-sm text-foreground">
                        {header.name}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {header.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* External Docs Link */}
          {documentation.externalDocsUrl && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(documentation.externalDocsUrl, "_blank")
                }
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full Documentation
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
