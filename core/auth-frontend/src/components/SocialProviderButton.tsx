import React from "react";
import {
  Button,
  DynamicIcon,
  type LucideIconName,
} from "@checkmate-monitor/ui";

interface SocialProviderButtonProps {
  displayName: string;
  icon?: LucideIconName;
  onClick: () => void;
}

export const SocialProviderButton: React.FC<SocialProviderButtonProps> = ({
  displayName,
  icon,
  onClick,
}) => {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
    >
      <DynamicIcon name={icon} className="h-4 w-4" />
      <span className="ml-2">Continue with {displayName}</span>
    </Button>
  );
};
