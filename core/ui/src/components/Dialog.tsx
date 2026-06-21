import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import { PortalContainerContext } from "./portalContainer";
import { OVERLAY_ENTER_ANIMATION } from "./overlayAnimation";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
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
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const dialogContentVariants = cva(
  "w-full border border-border bg-background text-foreground p-6 shadow-lg sm:rounded-lg max-h-[85dvh] overflow-y-auto overflow-x-visible",
  {
    variants: {
      size: {
        sm: "max-w-sm",
        default: "max-w-lg",
        lg: "max-w-2xl",
        xl: "max-w-4xl",
        full: "max-w-[90vw]",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

interface DialogContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {}

interface DialogContentExtraProps {
  hideCloseButton?: boolean;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps & DialogContentExtraProps
>(({ className, children, size, hideCloseButton, ...props }, ref) => {
  const { isLowPower } = usePerformance();
  // Expose the content element so popovers/comboboxes inside the dialog portal
  // INTO it, otherwise the modal scroll-lock blocks their internal scrolling.
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
    <DialogPortal>
      <DialogOverlay />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <DialogPrimitive.Content
          ref={setRefs}
          className={cn(
            "pointer-events-auto relative",
            dialogContentVariants({ size }),
            !isLowPower &&
              "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
          {...props}
        >
          <PortalContainerContext.Provider value={content}>
            {/* `min-h-0 flex-1` lets this wrapper fill the height when a
                consumer makes `DialogContent` a tall flex column (e.g. the
                CodeEditor popout, so a `fillHeight` editor fills the body).
                Inert for the default (non-flex) dialog: `flex-1` only affects
                flex items, and `min-h-0` is the block default. */}
            <div className="-mx-2 px-2 flex min-h-0 flex-1 flex-col gap-6">
              {children}
            </div>
            {!hideCloseButton && (
              <DialogPrimitive.Close
                className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </PortalContainerContext.Provider>
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
