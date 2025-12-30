import React, { useRef } from "react";

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
      onTabChange(items[newIndex].id);
      tabRefs.current.get(items[newIndex].id)?.focus();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className="flex gap-1 p-1 bg-muted/30 rounded-lg"
        role="tablist"
        aria-label="Tabs"
      >
        {items.map((item, index) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(item.id, el);
                } else {
                  tabRefs.current.delete(item.id);
                }
              }}
              onClick={() => onTabChange(item.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`
                relative px-4 py-2.5 flex items-center gap-2 rounded-md
                text-sm font-medium transition-all duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0
                ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }
              `}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
            >
              {item.icon && (
                <span
                  className={`transition-all duration-200 ${
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

  return isActive ? (
    <div
      id={`tabpanel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className={`animate-in fade-in-0 duration-200 ${className}`}
    >
      {children}
    </div>
  ) : (
    <></>
  );
};
