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

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed top-4 right-4 z-[500] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
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
