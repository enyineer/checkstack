import { useMemo, useState } from "react";
import {
  BookOpen,
  HelpCircle,
  Lightbulb,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";
import { APP_DOC_SLUGS, docsPath } from "@checkstack/common";
import { useResetAllTips } from "@checkstack/tips-frontend";
import {
  Button,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuCloseContext,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  useIsMobile,
  useToast,
} from "@checkstack/ui";

const POPOVER_CONTENT_CLASS =
  "w-[320px] p-2 flex flex-col gap-1 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto";

/**
 * A one-line legend that teaches the two in-app coaching conventions so they
 * don't need re-explaining per page: the amber lightbulb (concept tip) versus
 * the native tooltip (affordance hint). Mirrors the copy the dashboard banner
 * uses for the lightbulb.
 */
const ConventionLegend = () => (
  <div className="px-4 py-2 flex flex-col gap-1.5 text-[11px] leading-snug text-muted-foreground">
    <span className="inline-flex items-start gap-2">
      <Lightbulb
        className="size-3.5 shrink-0 mt-0.5 text-warning"
        aria-hidden="true"
      />
      <span>
        <strong className="text-foreground">Lightbulb</strong> - click for a
        short explanation of a concept.
      </span>
    </span>
    <span className="inline-flex items-start gap-2">
      <MousePointerClick
        className="size-3.5 shrink-0 mt-0.5 text-muted-foreground"
        aria-hidden="true"
      />
      <span>
        <strong className="text-foreground">Tooltip</strong> - hover a control
        for a hint about what it does.
      </span>
    </span>
  </div>
);

/**
 * The contents shared by the desktop popover and the mobile sheet. Rendered
 * inside a `MenuCloseContext` so `DropdownMenuItem`s close the surface on click.
 */
const HelpMenuItems = ({ onReplayTips }: { onReplayTips: () => void }) => {
  const { isResetting } = useResetAllTips();

  return (
    <>
      <DropdownMenuLabel>Help</DropdownMenuLabel>
      <a
        href={docsPath(APP_DOC_SLUGS.userGuideHome)}
        target="_blank"
        rel="noreferrer"
      >
        <DropdownMenuItem
          icon={<BookOpen className="h-4 w-4" />}
          description="Open the user guide"
        >
          Documentation
        </DropdownMenuItem>
      </a>
      <DropdownMenuItem
        icon={<RotateCcw className="h-4 w-4" />}
        description="Restore dismissed concept tips"
        onClick={onReplayTips}
        closeOnClick={!isResetting}
      >
        Show tips again
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ConventionLegend />
    </>
  );
};

/**
 * A persistent, always-reachable global help affordance in the navbar. Holds
 * the Documentation link, a "Show tips again" action (replays dismissed
 * onboarding coaching), and a short legend for the lightbulb / tooltip
 * conventions. Mirrors the `UserMenu` shape (desktop popover, mobile sheet).
 */
export const HelpMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();
  const toast = useToast();
  const { resetAll } = useResetAllTips();

  const closeContextValue = useMemo(
    () => ({ onClose: () => setIsOpen(false) }),
    [],
  );

  const onReplayTips = () => {
    resetAll();
    toast.success("Tips restored. They'll show again as you navigate.");
  };

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Help and documentation"
      className="rounded-full"
    >
      <HelpCircle className="h-5 w-5" />
    </Button>
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
              <SheetTitle className="text-base">Help</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1 [&>*]:shrink-0">
              <HelpMenuItems onReplayTips={onReplayTips} />
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
          className={POPOVER_CONTENT_CLASS}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <HelpMenuItems onReplayTips={onReplayTips} />
        </PopoverContent>
      </Popover>
    </MenuCloseContext.Provider>
  );
};
