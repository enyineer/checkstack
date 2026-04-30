import React, { createContext, useContext } from "react";
import { cn } from "../utils";

export const MenuCloseContext = createContext<{ onClose?: () => void }>({});

export const DropdownMenuItem: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  closeOnClick?: boolean;
}> = ({
  children,
  onClick,
  className,
  icon,
  description,
  closeOnClick = true,
}) => {
  const { onClose } = useContext(MenuCloseContext);

  const handleClick = () => {
    if (onClick) onClick();
    if (closeOnClick && onClose) onClose();
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex flex-col items-start w-full px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors rounded-sm overflow-hidden",
        className,
      )}
      role="menuitem"
      type="button"
    >
      <div className="flex items-center w-full overflow-hidden">
        {icon && (
          <span className="mr-3 text-muted-foreground shrink-0">{icon}</span>
        )}
        <span className="flex-1 text-left truncate">{children}</span>
      </div>
      {description && (
        <span
          className={cn(
            "text-[10px] text-muted-foreground mt-1 leading-tight text-left truncate w-full",
            icon ? "pl-7" : "",
          )}
        >
          {description}
        </span>
      )}
    </button>
  );
};

export const DropdownMenuSeparator: React.FC<{ className?: string }> = ({
  className,
}) => (
  <div className={cn("my-1 h-px bg-border col-span-full", className)} />
);

export const DropdownMenuLabel: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      "px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider col-span-full",
      className,
    )}
  >
    {children}
  </div>
);
