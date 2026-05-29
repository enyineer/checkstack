import React from "react";
import type { AutomationDefinition } from "@checkstack/automation-common";

/**
 * Threads the live `AutomationDefinition` through the editor tree so
 * recursively-rendered cards can resolve their variable scope against
 * the latest state without prop-drilling. Updated by the top-level
 * `AutomationDefinitionEditor` on every edit.
 */
interface AutomationDefinitionContextValue {
  definition: AutomationDefinition;
}

const AutomationDefinitionContext =
  React.createContext<AutomationDefinitionContextValue | null>(null);

export const AutomationDefinitionProvider: React.FC<{
  definition: AutomationDefinition;
  children: React.ReactNode;
}> = ({ definition, children }) => {
  const value = React.useMemo(() => ({ definition }), [definition]);
  return (
    <AutomationDefinitionContext.Provider value={value}>
      {children}
    </AutomationDefinitionContext.Provider>
  );
};

export function useAutomationDefinitionContext(): AutomationDefinitionContextValue {
  const ctx = React.useContext(AutomationDefinitionContext);
  if (!ctx) {
    throw new Error(
      "useAutomationDefinitionContext must be used inside <AutomationDefinitionProvider>",
    );
  }
  return ctx;
}
