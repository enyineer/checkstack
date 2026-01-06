import { useState } from "react";
import {
  Card,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@checkmate-monitor/ui";
import { ChevronDown, ChevronUp, ExternalLink, FileJson } from "lucide-react";
import type { IntegrationProviderInfo } from "@checkmate-monitor/integration-common";

interface ProviderDocumentationProps {
  provider: IntegrationProviderInfo;
}

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
    <div className="border rounded-md">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileJson className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Documentation</span>
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
        <div className="px-3 pb-3 space-y-4">
          {/* Setup Guide */}
          {documentation.setupGuide && (
            <div>
              <h4 className="text-sm font-medium mb-2">Setup Guide</h4>
              <div className="bg-muted/50 p-3 rounded-md text-sm whitespace-pre-wrap">
                {documentation.setupGuide}
              </div>
            </div>
          )}

          {/* Example Payload */}
          {documentation.examplePayload && (
            <div>
              <h4 className="text-sm font-medium mb-2">Example Payload</h4>
              <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
                <code>{documentation.examplePayload}</code>
              </pre>
            </div>
          )}

          {/* Headers */}
          {documentation.headers && documentation.headers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">HTTP Headers</h4>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">Header</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documentation.headers.map((header) => (
                      <TableRow key={header.name}>
                        <TableCell className="font-mono text-sm">
                          {header.name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {header.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
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
