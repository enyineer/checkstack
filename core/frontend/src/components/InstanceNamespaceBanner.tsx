import React from "react";
import { useRuntimeConfig } from "@checkstack/frontend-api";
import { cn } from "@checkstack/ui";
import { FlaskConical } from "lucide-react";
import { describeInstanceBanner } from "./InstanceNamespaceBanner.logic";

/**
 * A slim, always-visible strip shown at the very top of the app shell when the
 * backend runs as a SECONDARY instance (a non-empty `instanceNamespace` in the
 * runtime config, e.g. the PR-preview instance). It makes it unmistakable that
 * the current page is NOT the default instance.
 *
 * Styling is fully static (no animation, blur or transition), so it is
 * isLowPower-safe by construction and needs no `usePerformance` gate.
 */
export const InstanceNamespaceBanner: React.FC = () => {
  const { instanceNamespace } = useRuntimeConfig();
  const view = describeInstanceBanner({ namespace: instanceNamespace });
  if (!view) return null;

  return (
    <div
      role="status"
      title={view.title}
      className={cn(
        "w-full border-b border-primary/20 bg-primary/10 px-4 py-2",
      )}
    >
      <div className="flex items-center gap-2 max-w-7xl mx-auto text-primary">
        <FlaskConical className="h-4 w-4 flex-shrink-0" />
        <span className="text-sm font-medium">{view.label}</span>
      </div>
    </div>
  );
};
