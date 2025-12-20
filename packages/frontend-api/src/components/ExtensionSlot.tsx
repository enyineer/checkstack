import React from "react";
import { pluginRegistry } from "../plugin-registry";

interface ExtensionSlotProps {
  id: string; // The slot ID, e.g., 'core.layout.navbar'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any; // Context data to pass to extensions
}

export const ExtensionSlot: React.FC<ExtensionSlotProps> = ({
  id,
  context,
}) => {
  const extensions = pluginRegistry.getExtensions(id);

  if (extensions.length === 0) {
    return <></>;
  }

  return (
    <>
      {extensions.map((ext) => (
        <ext.component key={ext.id} {...context} />
      ))}
    </>
  );
};
