import { useState } from "react";
import { Palette } from "lucide-react";
import { useTheme, useToast, type Theme } from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import { ThemeApi } from "@checkstack/theme-common";
import { extractErrorMessage } from "@checkstack/common";
import { ThemeModeSelector } from "./ThemeModeSelector";

/**
 * Theme selector for logged-in users (displayed in UserMenu).
 *
 * Saves the theme to both the backend (for persistence across devices) and
 * local storage (for continuity when logging out).
 *
 * Theme initialization is handled by ThemeSynchronizer.
 */
export const ThemeToggleMenuItem = () => {
  const { theme, setTheme } = useTheme();
  const themeClient = usePluginClient(ThemeApi);
  const setThemeMutation = themeClient.setTheme.useMutation();
  const toast = useToast();

  // Only used to restore the previous choice if the save fails. The displayed
  // value comes straight from the provider, so there is no local mirror of the
  // theme to fall out of sync with it.
  const [saving, setSaving] = useState(false);

  const handleSelect = async (nextTheme: Theme) => {
    if (nextTheme === theme) return;
    const previous = theme;

    // Apply immediately - the choice should feel instant even if the round-trip
    // is slow. Also persists to local storage via ThemeProvider.
    setTheme(nextTheme);
    setSaving(true);

    try {
      await setThemeMutation.mutateAsync({ theme: nextTheme });
    } catch (error) {
      toast.error(extractErrorMessage(error, "Failed to save theme preference"));
      setTheme(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 w-full px-4 py-2 text-sm text-popover-foreground rounded-sm">
      <div className="flex items-center min-w-0">
        <Palette className="h-4 w-4 text-muted-foreground shrink-0 mr-3" />
        <span className="truncate">Theme</span>
      </div>
      <ThemeModeSelector
        value={theme}
        onChange={(next) => void handleSelect(next)}
        disabled={saving}
      />
    </div>
  );
};
