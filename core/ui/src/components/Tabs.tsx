import React, { useEffect, useRef, useState } from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

/** How long the click-flash ring stays applied before fading back out. */
const FLASH_MS = 250;

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  activeTab,
  onTabChange,
  className = "",
}) => {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const { isLowPower } = usePerformance();

  // Deliberate activation feedback: a short-lived ring on the tab that was
  // actually activated (click completed / keyboard-selected). Mouse-down focus
  // is suppressed below, so this state - not a browser focus heuristic - is
  // the ONLY thing that flashes; Safari used to flash its focus ring already
  // on press, before the click had committed.
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const selectTab = (tabId: string) => {
    if (!isLowPower) {
      setFlashId(tabId);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), FLASH_MS);
    }
    onTabChange(tabId);
  };

  const handleKeyDown = (event: React.KeyboardEvent, currentIndex: number) => {
    let newIndex = currentIndex;

    switch (event.key) {
      case "ArrowLeft": {
        newIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        event.preventDefault();
        break;
      }
      case "ArrowRight": {
        newIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        event.preventDefault();
        break;
      }
      case "Home": {
        newIndex = 0;
        event.preventDefault();
        break;
      }
      case "End": {
        newIndex = items.length - 1;
        event.preventDefault();
        break;
      }
      default: {
        // No action needed for other keys
        break;
      }
    }

    if (newIndex !== currentIndex) {
      selectTab(items[newIndex].id);
      tabRefs.current.get(items[newIndex].id)?.focus();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className="flex flex-col md:flex-row gap-1 p-1 bg-muted/30 rounded-lg"
        role="tablist"
        aria-label="Tabs"
      >
        {items.map((item, index) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(item.id, el);
                } else {
                  tabRefs.current.delete(item.id);
                }
              }}
              onClick={() => {
                selectTab(item.id);
                // Mouse-down focus is prevented below; restore focus here so
                // arrow-key navigation continues from the clicked tab.
                tabRefs.current.get(item.id)?.focus({ preventScroll: true });
              }}
              // Suppress mouse-driven focus: Safari applies (and flashes) the
              // focus ring already on press, before the click commits. The
              // deliberate flash in `selectTab` replaces it, and keyboard
              // focus (focus-visible) is unaffected.
              onMouseDown={(e) => e.preventDefault()}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`
                relative px-4 py-2.5 flex items-center justify-center md:justify-start gap-2 rounded-md
                text-sm font-medium transition-all duration-200
                [-webkit-tap-highlight-color:transparent]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0
                ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }
                ${flashId === item.id ? "ring-2 ring-primary/40" : ""}
              `}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
            >
              {item.icon && (
                // transition-TRANSFORM only: with `transition-all`, the span
                // re-transitions the color it INHERITS from the button (which
                // is itself mid-transition), so the icon visibly lags the
                // label - most noticeably in Safari. The transform (active
                // scale) is the only property this span animates itself.
                <span
                  className={`transition-transform duration-200 ${
                    isActive ? "scale-110" : ""
                  }`}
                >
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export interface TabPanelProps {
  id: string;
  activeTab: string;
  children: React.ReactNode;
  className?: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({
  id,
  activeTab,
  children,
  className = "",
}) => {
  const isActive = activeTab === id;
  const { isLowPower } = usePerformance();

  return isActive ? (
    <div
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className={cn(
        !isLowPower && "animate-in fade-in-0 duration-200",
        className,
      )}
    >
      {children}
    </div>
  ) : (
    <></>
  );
};
