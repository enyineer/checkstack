import React, { useRef, useEffect, createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

export const DropdownMenuContext = createContext<{ onClose?: () => void }>({});

/**
 * Custom hook to detect mobile viewport.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Initial check
    const mql = globalThis.matchMedia("(max-width: 640px)");
    setIsMobile(mql.matches);

    // Listener for changes
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}


export const DropdownMenuRootContext = createContext<{ rootRef?: React.RefObject<HTMLDivElement> }>({});

export const DropdownMenu: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenuRootContext.Provider value={{ rootRef }}>
      <div ref={rootRef} className="relative inline-block text-left">{children}</div>
    </DropdownMenuRootContext.Provider>
  );
};

export const DropdownMenuTrigger: React.FC<{
  children: React.ReactNode;
  asChild?: boolean;
  onClick?: () => void;
}> = ({ children, onClick }) => {
  return (
    <div onClick={onClick} className="cursor-pointer">
      {children}
    </div>
  );
};

export const DropdownMenuContent: React.FC<{
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  innerClassName?: string;
}> = ({ children, isOpen, onClose, className, innerClassName }) => {
  const { isLowPower } = usePerformance();
  const contentRef = useRef<HTMLDivElement>(null);
  const { rootRef } = useContext(DropdownMenuRootContext);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't auto-close if clicking outside on mobile (full screen modal style)
      if (isMobile) return;
      
      const target = event.target as Node;
      
      // Don't close if clicking inside the menu content
      if (contentRef.current && contentRef.current.contains(target)) {
        return;
      }
      
      // Don't close if clicking inside the wrapper (e.g. the trigger button)
      // This allows the trigger's onClick to handle toggling the menu without conflict.
      if (rootRef?.current && rootRef.current.contains(target)) {
        return;
      }
      
      onClose();
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      // Lock body scroll on mobile
      if (isMobile) {
        document.body.style.overflow = "hidden";
      }
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (isMobile) {
        document.body.style.overflow = "";
      }
    };
  }, [isOpen, onClose, isMobile, rootRef]);

  if (!isOpen) return <React.Fragment />;

  const content = (
    <div
      ref={contentRef}
      className={cn(
        isMobile
          ? "fixed inset-0 z-[100] bg-background w-full h-full p-4 overflow-y-auto"
          : "absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-popover shadow-lg ring-1 ring-border focus:outline-none z-[100] max-h-[calc(100vh-4rem)] overflow-y-auto",
        !isLowPower && "animate-in fade-in zoom-in-95 duration-100",
        className
      )}
    >
      <DropdownMenuContext.Provider value={{ onClose }}>
        <div className={cn(isMobile ? "flex flex-col pt-4 pb-12" : "py-1", innerClassName)} role="none">
          {isMobile && (
            <div className="flex justify-between items-center mb-6 col-span-full px-2">
              <h2 className="text-xl font-bold text-foreground">Menu</h2>
              <button 
                onClick={onClose} 
                className="p-2 rounded-full hover:bg-accent text-muted-foreground transition-colors"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          )}
          {children}
        </div>
      </DropdownMenuContext.Provider>
    </div>
  );

  return isMobile ? createPortal(content, document.body) : content;
};

export const DropdownMenuItem: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  closeOnClick?: boolean;
}> = ({ children, onClick, className, icon, description, closeOnClick = true }) => {
  const { onClose } = useContext(DropdownMenuContext);

  const handleClick = () => {
    if (onClick) onClick();
    if (closeOnClick && onClose) onClose();
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex flex-col items-start w-full px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors rounded-sm overflow-hidden",
        className
      )}
      role="menuitem"
    >
      <div className="flex items-center w-full overflow-hidden">
        {icon && <span className="mr-3 text-muted-foreground shrink-0">{icon}</span>}
        <span className="flex-1 text-left truncate">{children}</span>
      </div>
      {description && (
        <span className={cn("text-[10px] text-muted-foreground mt-1 leading-tight text-left truncate w-full", icon ? "pl-7" : "")}>
          {description}
        </span>
      )}
    </button>
  );
};

export const DropdownMenuSeparator: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("my-1 h-px bg-border col-span-full", className)} />
);

export const DropdownMenuLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => (
  <div className={cn("px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider col-span-full", className)}>
    {children}
  </div>
);
