import React, { useState, useRef, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../utils";
import { useApi, permissionApiRef } from "@checkmate/frontend-api";

export interface NavItemProps {
  to?: string;
  label: string;
  icon?: React.ReactNode;
  permission?: string;
  children?: React.ReactNode;
  className?: string;
}

export const NavItem: React.FC<NavItemProps> = ({
  to,
  label,
  icon,
  permission,
  children,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Always call hooks at top level
  // We assume permissionApi is available if we use it. Safe fallback?
  // ApiProvider guarantees it if registered. App.tsx registers a default.
  const permissionApi = useApi(permissionApiRef);
  const hasPermission = permissionApi.usePermission(permission || "");
  const hasAccess = permission ? hasPermission : true;

  // Handle click outside for dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!hasAccess) return <></>;

  const baseClasses = cn(
    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500/50",
    className
  );

  const activeClasses = "bg-indigo-50 text-indigo-700";

  // Dropdown / Parent Item
  if (children) {
    // Check if any child is active to highlight parent
    // This is naive; normally we'd check paths.
    // For now, let's just rely on click state or strict path matching if 'to' is present on parent.

    return (
      <div className="relative group" ref={containerRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(baseClasses, isOpen && activeClasses)}
          aria-expanded={isOpen}
        >
          {icon && <span className="w-4 h-4">{icon}</span>}
          <span>{label}</span>
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform",
              isOpen ? "rotate-180" : ""
            )}
          />
        </button>

        {isOpen && (
          <div className="absolute left-0 mt-1 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="py-1 flex flex-col p-1 gap-1">{children}</div>
          </div>
        )}
      </div>
    );
  }

  // Leaf Item (Link)
  if (to) {
    return (
      <NavLink
        to={to}
        className={({ isActive }) => cn(baseClasses, isActive && activeClasses)}
        end
      >
        {icon && <span className="w-4 h-4">{icon}</span>}
        <span>{label}</span>
      </NavLink>
    );
  }

  // Fallback (just a label?)
  return (
    <div className={baseClasses}>
      {icon && <span className="w-4 h-4">{icon}</span>}
      <span>{label}</span>
    </div>
  );
};
