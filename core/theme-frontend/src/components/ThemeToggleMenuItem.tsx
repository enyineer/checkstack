import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Toggle, useTheme, useToast } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { ThemeApi } from "@checkstack/theme-common";

/**
 * Theme toggle menu item for logged-in users (displayed in UserMenu).
 *
 * Saves theme to both backend (for persistence across devices) and
 * local storage (for continuity when logging out).
 *
 * Theme initialization is handled by ThemeSynchronizer component.
 */
export const ThemeToggleMenuItem = () => {
  const { theme, setTheme } = useTheme();
  const themeClient = usePluginClient(ThemeApi);
  const setThemeMutation = themeClient.setTheme.useMutation();

  const [isDark, setIsDark] = useState(theme === "dark");
  const toast = useToast();

  // Update local state when theme changes (e.g., from ThemeSynchronizer)
  useEffect(() => {
    setIsDark(theme === "dark");
  }, [theme]);

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
        error instanceof Error
          ? error.message
          : "Failed to save theme preference";
      toast.error(message);
      console.error("Failed to save theme preference:", error);
      // Revert on error
      setIsDark(!checked);
      setTheme(checked ? "light" : "dark");
    }
  };

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground">
      <div className="flex items-center gap-2">
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        <span>Dark Mode</span>
      </div>
      <Toggle
        checked={isDark}
        onCheckedChange={handleToggle}
        disabled={setThemeMutation.isPending}
        aria-label="Toggle dark mode"
      />
    </div>
  );
};
