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
            "flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-accent transition-all border border-transparent hover:border-border",
            isOpen && "bg-accent border-border",
            className
          )}
        >
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary">
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
          <span className="text-sm font-medium text-foreground hidden sm:inline-block max-w-[120px] truncate">
            {user.name || user.email}
          </span>
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)}
        className="w-full sm:w-[400px] md:w-[460px]"
        innerClassName="grid grid-cols-1 sm:grid-cols-2 p-2 gap-2 sm:gap-1"
      >
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground truncate">
              {user.name || "User"}
            </span>
            <span className="text-xs font-normal text-muted-foreground truncate">
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
