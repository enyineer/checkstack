import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import { useTheme } from "../src/components/ThemeProvider";

const meta: Meta = {
  title: "Foundations/ThemeProvider",
};

export default meta;
type Story = StoryObj;

const Demo = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Theme: <strong>{theme}</strong> (resolved: {resolvedTheme})
      </p>
      <div className="flex gap-2">
        <Button variant={theme === "light" ? "primary" : "outline"} onClick={() => setTheme("light")}>
          Light
        </Button>
        <Button variant={theme === "dark" ? "primary" : "outline"} onClick={() => setTheme("dark")}>
          Dark
        </Button>
        <Button variant={theme === "system" ? "primary" : "outline"} onClick={() => setTheme("system")}>
          System
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The host frontend wraps the app in <code>ThemeProvider</code>; plugins
        inherit it for free.
      </p>
    </div>
  );
};

export const Switcher: Story = { render: () => <Demo /> };
