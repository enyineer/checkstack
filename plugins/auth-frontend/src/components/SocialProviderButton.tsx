import React from "react";
import { Button } from "@checkmate/ui";
import * as LucideIcons from "lucide-react";

interface SocialProviderButtonProps {
  displayName: string;
  icon?: string; // Lucide icon name
  onClick: () => void;
}

const getIconComponent = (iconName?: string) => {
  if (!iconName) {
    return <LucideIcons.Mail className="h-4 w-4" />;
  }

  // Convert icon name to PascalCase for Lucide icon lookup
  const pascalCase = iconName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  // Dynamically look up the icon from lucide-react
  // Type assertion is safe here since we provide a fallback
  const IconComponent = (
    LucideIcons as unknown as Record<
      string,
      React.ComponentType<{ className?: string }>
    >
  )[pascalCase];

  if (!IconComponent) {
    // Fallback to Mail icon if not found
    return <LucideIcons.Mail className="h-4 w-4" />;
  }

  return <IconComponent className="h-4 w-4" />;
};

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
      {getIconComponent(icon)}
      <span className="ml-2">Continue with {displayName}</span>
    </Button>
  );
};
