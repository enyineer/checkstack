import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Toggle, useTheme, useToast } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { ThemeApi } from "@checkstack/theme-common";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Theme toggle menu item for logged-in users (displayed in UserMenu).
 *
 * Saves theme to both backend (for persistence across devices) and
 * local storage (for continuity when logging out).
 *
 * Theme initialization is handled by ThemeSynchronizer component.
 */
export const ThemeToggleMenuItem = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const themeClient = usePluginClient(ThemeApi);
  const setThemeMutation = themeClient.setTheme.useMutation();

  const [isDark, setIsDark] = useState(resolvedTheme === "dark");
  const toast = useToast();

  // Update local state when theme changes (e.g., from ThemeSynchronizer)
  // eslint-disable-next-line checkstack/no-state-seed-in-effect -- one-way mirror of the global resolved theme (a primitive) into local toggle display; the user never edits this state, so there is nothing to wipe.
  useEffect(() => {
    setIsDark(resolvedTheme === "dark");
  }, [resolvedTheme]);

  const handleToggle = async (checked: boolean) => {
    const newTheme = checked ? "dark" : "light";

    // Update UI immediately
    setIsDark(checked);
    setTheme(newTheme); // Also updates local storage via ThemeProvider

    // Save to backend
    try {
      await setThemeMutation.mutateAsync({ theme: newTheme });
    } catch (error) {
      const message =
        extractErrorMessage(error, "Failed to save theme preference");
      toast.error(message);
      // Revert on error
      setIsDark(!checked);
      setTheme(checked ? "light" : "dark");
    }
  };

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors">
      <div className="flex flex-col flex-1 items-start">
        <div className="flex items-center w-full">
          {isDark ? (
            <Moon className="h-4 w-4 text-muted-foreground shrink-0 mr-3" />
          ) : (
            <Sun className="h-4 w-4 text-muted-foreground shrink-0 mr-3" />
          )}
          <span className="flex-1 text-left">Dark Mode</span>
        </div>
      </div>
      <div className="ml-2 shrink-0 flex items-center">
        <Toggle
          checked={isDark}
          onCheckedChange={handleToggle}
          disabled={setThemeMutation.isPending}
          aria-label="Toggle dark mode"
        />
      </div>
    </div>
  );
};
