import React, { useState } from "react";
import { User, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./DropdownMenu";
import { cn } from "../utils";

interface UserMenuProps {
  user: {
    email?: string;
    name?: string;
    image?: string;
  };
  children?: React.ReactNode;
  className?: string;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  user,
  children,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger onClick={() => setIsOpen(!isOpen)}>
        <button
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-all border border-transparent hover:border-gray-200",
            isOpen && "bg-gray-100 border-gray-200",
            className
          )}
        >
          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
            {user.image ? (
              <img
                src={user.image}
                alt={user.name || "User"}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <User size={14} />
            )}
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:inline-block max-w-[120px] truncate">
            {user.name || user.email}
          </span>
          <ChevronDown
            size={14}
            className={cn(
              "text-gray-400 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-gray-900 truncate">
              {user.name || "User"}
            </span>
            <span className="text-xs font-normal text-gray-500 truncate">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
