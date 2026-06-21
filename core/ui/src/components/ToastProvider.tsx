import React, { useContext, useState, useCallback } from "react";
import { Toast } from "./Toast";
import { createRegisteredContext } from "../utils/registered-context";

type ToastVariant = "default" | "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

/**
 * Maximum number of toasts rendered at once. Older toasts beyond this cap are
 * kept in state (so they keep counting toward the overflow indicator) but are
 * not rendered; they surface as the most recent ones dismiss/expire.
 */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * Pure selection of the visible toast window + overflow count. Given the full
 * ordered queue (oldest first, as pushed), returns the `cap` most-recent items
 * (kept in their original oldest-first order for stable rendering) and the
 * number of older items hidden behind the cap.
 */
export const selectVisibleToasts = <T,>({
  toasts,
  cap = MAX_VISIBLE_TOASTS,
}: {
  toasts: readonly T[];
  cap?: number;
}): { visible: T[]; overflowCount: number } => {
  const safeCap = Math.max(0, cap);
  const overflowCount = Math.max(0, toasts.length - safeCap);
  const visible = safeCap === 0 ? [] : toasts.slice(-safeCap);
  return { visible, overflowCount };
};

interface ToastContextValue {
  show: ({
    message,
    variant,
    duration,
  }: {
    message: string;
    variant?: ToastVariant;
    duration?: number;
  }) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

// Registered (singleton) context: shared between the host's provider and a
// plugin's useToast() even though @checkstack/ui is bundled per consumer.
const ToastContext = createRegisteredContext<ToastContextValue | undefined>(
  "checkstack.ui.toast",
);

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    ({
      message,
      variant = "default",
      duration = 4000,
    }: {
      message: string;
      variant?: ToastVariant;
      duration?: number;
    }) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const newToast: ToastItem = { id, message, variant, duration };
      setToasts((prev) => [...prev, newToast]);
    },
    []
  );

  const success = useCallback(
    (message: string, duration?: number) => {
      show({ message, variant: "success", duration });
    },
    [show]
  );

  const error = useCallback(
    (message: string, duration?: number) => {
      show({ message, variant: "error", duration });
    },
    [show]
  );

  const warning = useCallback(
    (message: string, duration?: number) => {
      show({ message, variant: "warning", duration });
    },
    [show]
  );

  const info = useCallback(
    (message: string, duration?: number) => {
      show({ message, variant: "info", duration });
    },
    [show]
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      show,
      success,
      error,
      warning,
      info,
    }),
    [show, success, error, warning, info]
  );

  const { visible, overflowCount } = selectVisibleToasts({ toasts });

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-4 bottom-4 z-[500] flex flex-col gap-2 pointer-events-none sm:inset-x-auto sm:bottom-auto sm:top-4 sm:right-4 sm:max-w-md"
        aria-live="polite"
        aria-atomic="true"
      >
        {overflowCount > 0 && (
          <div className="pointer-events-none self-stretch sm:self-end">
            <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground shadow-sm">
              +{overflowCount} more
            </span>
          </div>
        )}
        {visible.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast
              id={toast.id}
              message={toast.message}
              variant={toast.variant}
              duration={toast.duration}
              onDismiss={dismissToast}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
