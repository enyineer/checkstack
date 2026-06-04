import React, { useMemo, useState } from "react";
import { User, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";
import { MenuCloseContext, DropdownMenuLabel, DropdownMenuSeparator } from "./Menu";
import { useIsMobile } from "../hooks/useIsMobile";
import { cn } from "../utils";
import {
  DESKTOP_POPOVER_CONTENT_CLASS,
  shouldRenderProfileHeaderLink,
} from "./UserMenu.logic";

interface UserMenuProps {
  user: {
    email?: string;
    name?: string;
    image?: string;
  };
  /**
   * Optional href for the profile link rendered in the user info header.
   * When provided, the name/email header becomes a focusable anchor that
   * navigates to the profile page - supporting middle-click / open-in-new-tab.
   * UserMenu must NOT import router hooks, so the caller is responsible for
   * constructing this href (e.g. `resolveRoute(authRoutes.routes.profile)`).
   */
  profileHref?: string;
  children?: React.ReactNode;
  className?: string;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  user,
  profileHref,
  children,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();

  const closeContextValue = useMemo(
    () => ({ onClose: () => setIsOpen(false) }),
    [],
  );

  const trigger = (
    <button
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-accent transition-all border border-transparent hover:border-border",
        isOpen && "bg-accent border-border",
        className,
      )}
      type="button"
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
          isOpen && "rotate-180",
        )}
      />
    </button>
  );

  const userInfoContent = (
    <div className="flex flex-col">
      <span className="text-sm font-bold text-foreground truncate">
        {user.name || "User"}
      </span>
      <span className="text-xs font-normal text-muted-foreground truncate">
        {user.email}
      </span>
    </div>
  );

  const userInfo = shouldRenderProfileHeaderLink(profileHref) ? (
    <a
      href={profileHref}
      onClick={() => setIsOpen(false)}
      className={cn(
        "col-span-full block px-4 py-2 rounded-sm",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "transition-colors",
      )}
    >
      {userInfoContent}
      <span className="sr-only"> - Go to profile</span>
    </a>
  ) : (
    <DropdownMenuLabel>{userInfoContent}</DropdownMenuLabel>
  );

  if (isMobile) {
    return (
      <MenuCloseContext.Provider value={closeContextValue}>
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent
            size="full"
            className="flex flex-col p-0"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle className="text-base">Menu</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1 [&>*]:shrink-0">
              {userInfo}
              <DropdownMenuSeparator />
              {children}
            </div>
          </SheetContent>
        </Sheet>
      </MenuCloseContext.Provider>
    );
  }

  return (
    <MenuCloseContext.Provider value={closeContextValue}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          className={DESKTOP_POPOVER_CONTENT_CLASS}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {userInfo}
          <DropdownMenuSeparator />
          {children}
        </PopoverContent>
      </Popover>
    </MenuCloseContext.Provider>
  );
};
