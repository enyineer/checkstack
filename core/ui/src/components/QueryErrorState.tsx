import React from "react";
import { CircleAlert } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "./Alert";
import { Button } from "./Button";

interface QueryErrorStateProps {
  /**
   * The error captured from a failed query (e.g. TanStack Query's `error`).
   * Funnelled through {@link extractErrorMessage} so callers don't have to
   * narrow the type at every call site.
   */
  error: unknown;
  /**
   * Invoked when the user clicks the "Retry" button. Wire this to the
   * underlying `refetch()` of the failing query.
   */
  onRetry: () => void;
  /**
   * Optional resource name to personalise the headline, e.g.
   * `resource="checks"` -> "Could not load checks".
   */
  resource?: string;
}

/**
 * QueryErrorState - canonical inline error UI for failed list / detail
 * queries. Renders an `error`-variant {@link Alert} with the extracted
 * error message and a Retry button.
 */
export const QueryErrorState: React.FC<QueryErrorStateProps> = ({
  error,
  onRetry,
  resource,
}) => {
  const message = extractErrorMessage(error);
  const title = resource ? `Could not load ${resource}` : "Something went wrong";

  return (
    <Alert variant="error">
      <AlertIcon>
        <CircleAlert className="h-4 w-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </AlertContent>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="shrink-0"
      >
        Retry
      </Button>
    </Alert>
  );
};
