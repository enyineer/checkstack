import React, { useRef, useEffect } from "react";
import { cn } from "../utils";

export const DropdownMenu: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <div className="relative inline-block text-left">{children}</div>;
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
}> = ({ children, isOpen, onClose, className }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contentRef.current &&
        !contentRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return <React.Fragment />;

  return (
    <div
      ref={contentRef}
      className={cn(
        "absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-[100] animate-in fade-in zoom-in-95 duration-100",
        className
      )}
    >
      <div className="py-1" role="none">
        {children}
      </div>
    </div>
  );
};

export const DropdownMenuItem: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: React.ReactNode;
}> = ({ children, onClick, className, icon }) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors",
        className
      )}
      role="menuitem"
    >
      {icon && <span className="mr-3 text-gray-400">{icon}</span>}
      {children}
    </button>
  );
};

export const DropdownMenuSeparator: React.FC = () => (
  <div className="my-1 h-px bg-gray-100" />
);

export const DropdownMenuLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
    {children}
  </div>
);
