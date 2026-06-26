import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import { PortalContainerContext } from "./portalContainer";
import { OVERLAY_ENTER_ANIMATION } from "./overlayAnimation";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const { isLowPower } = usePerformance();
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        // Enter-only animation; see `overlayAnimation.ts` for why the overlay
        // must NOT animate out (orphaned-scrim bug). The Content animates out.
        !isLowPower && OVERLAY_ENTER_ANIMATION,
        className,
      )}
      {...props}
    />
  );
});
SheetOverlay.displayName = "SheetOverlay";

const sheetContentVariants = cva(
  "fixed z-50 flex flex-col bg-background shadow-lg border-l border-border",
  {
    variants: {
      size: {
        default: "w-full sm:max-w-lg",
        lg: "w-full sm:max-w-2xl",
        xl: "w-full sm:max-w-4xl",
        full: "w-full",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetContentVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, size, ...props }, ref) => {
  const { isLowPower } = usePerformance();
  // Expose the content element so popovers/comboboxes rendered inside the
  // sheet portal INTO it — otherwise the modal scroll-lock blocks their
  // internal scrolling (a popover portaled to body is outside the dialog).
  const [content, setContent] = React.useState<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContent(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        className={cn(
          sheetContentVariants({ size }),
          // Bound the height to the DYNAMIC viewport (not the layout viewport),
          // so on mobile the drawer ends at the visible bottom instead of behind
          // the browser URL bar - otherwise its trailing content (e.g. the last
          // nav items) is unreachable. Top-anchored; `dvh` tracks the chrome.
          "top-0 right-0 h-[100dvh] max-h-[100dvh]",
          !isLowPower &&
            "duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className,
        )}
        {...props}
      >
        <PortalContainerContext.Provider value={content}>
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </PortalContainerContext.Provider>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1.5 p-6 pb-4 border-b border-border",
      className,
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 overflow-y-auto p-6", className)} {...props} />
);
SheetBody.displayName = "SheetBody";

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
};
