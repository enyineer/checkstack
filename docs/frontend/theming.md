---
---
# Theming System

The Checkmate UI system uses a centralized, configurable theming architecture based on CSS Custom Properties (CSS variables) and HSL color space. This system provides automatic dark mode support, semantic color tokens, and consistent styling across the entire platform.

## Architecture Overview

The theming system consists of four key layers:

1. **CSS Variables** (`core/ui/src/themes.css`) - Core color definitions using HSL values
2. **Tailwind Integration** (`tailwind.config.js`) - Maps CSS variables to Tailwind utility classes
3. **Theme Provider** (`@checkmate-monitor/ui/ThemeProvider`) - Runtime theme management and persistence
4. **Component Adoption** - All components use semantic tokens instead of hardcoded colors

## How Theme Tokens Work

### HSL Color Space

All theme tokens are defined using the HSL (Hue, Saturation, Lightness) color space. This provides several advantages:

- **Easy manipulation**: Adjust brightness, saturation without recalculating RGB values
- **Opacity support**: Tailwind can inject alpha channels (e.g., `bg-primary/90`)
- **Consistent dark mode**: Adjust lightness values for optimal contrast

### CSS Variable Format

Theme tokens are stored as **raw HSL values** without the `hsl()` wrapper:

```css
:root {
  --primary: 262 83% 58%;  /* Not: hsl(262, 83%, 58%) */
}
```

This allows Tailwind to construct the full color value and apply opacity modifiers:

```tsx
// Tailwind converts this to: rgba(from hsl(262 83% 58%), opacity)
className="bg-primary/90"
```

### Automatic Dark Mode

Dark mode is handled via the `.dark` class applied to the document root:

```css
:root {
  --background: 0 0% 100%;  /* white */
}

.dark {
  --background: 240 10% 4%; /* dark blue-gray */
}
```

When the user toggles dark mode, the `ThemeProvider` adds/removes the `.dark` class, automatically switching all token values.

## Available Theme Tokens

### Brand & Actions

| Token | Purpose | Light Mode | Dark Mode | Usage |
|-------|---------|------------|-----------|-------|
| `primary` | Main brand color, primary actions | Purple `262 83% 58%` | Lighter purple `263 70% 65%` | Buttons, links, active states |
| `primary-foreground` | Text on primary backgrounds | White `0 0% 100%` | White `0 0% 100%` | Button text, badge text |
| `secondary` | Secondary actions, less emphasis | Light gray `240 5% 96%` | Dark gray `240 4% 16%` | Secondary buttons |
| `secondary-foreground` | Text on secondary backgrounds | Dark `240 6% 10%` | White `0 0% 100%` | Secondary button text |
| `accent` | Highlighted/hover states | Light gray `240 5% 96%` | Dark gray `240 4% 16%` | Hover backgrounds, menu items |
| `accent-foreground` | Text on accent backgrounds | Dark `240 6% 10%` | White `0 0% 100%` | Menu text, hover text |

### Surfaces & Backgrounds

| Token | Purpose | Light Mode | Dark Mode | Usage |
|-------|---------|------------|-----------|-------|
| `background` | Main page background | White `0 0% 100%` | Very dark `240 10% 4%` | `body`, main containers |
| `foreground` | Primary text color | Very dark `240 10% 4%` | Off-white `0 0% 98%` | Body text, headings |
| `card` | Elevated surface (cards, panels) | White `0 0% 100%` | Very dark `240 10% 4%` | Card backgrounds |
| `card-foreground` | Text on cards | Very dark `240 10% 4%` | Off-white `0 0% 98%` | Card text |
| `popover` | Floating elements (dropdowns, tooltips) | White `0 0% 100%` | Very dark `240 10% 4%` | Dropdown menus, tooltips |
| `popover-foreground` | Text in popovers | Very dark `240 10% 4%` | Off-white `0 0% 98%` | Dropdown text |
| `muted` | Subtle backgrounds, disabled states | Light gray `240 5% 96%` | Dark gray `240 4% 16%` | Input backgrounds, disabled |
| `muted-foreground` | Secondary text, placeholders | Medium gray `240 4% 46%` | Light gray `240 5% 65%` | Placeholders, labels |

### Borders & Inputs

| Token | Purpose | Light Mode | Dark Mode | Usage |
|-------|---------|------------|-----------|-------|
| `border` | General borders, dividers | Light gray `240 6% 90%` | Dark gray `240 4% 16%` | Card borders, dividers |
| `input` | Input field borders | Light gray `240 6% 90%` | Dark gray `240 4% 16%` | Text inputs, selects |
| `ring` | Focus rings, outlines | Purple `262 83% 58%` | Lighter purple `263 70% 65%` | Focus indicators |

### Semantic States

| Token | Purpose | Light Mode | Dark Mode | Usage |
|-------|---------|------------|-----------|-------|
| `destructive` | Errors, dangerous actions | Red `0 84% 60%` | Darker red `0 63% 50%` | Delete buttons, error states |
| `destructive-foreground` | Text on destructive backgrounds | Red-700 `0 74% 42%` | White `0 0% 100%` | Error text |
| `success` | Success states, confirmations | Green `142 71% 45%` | Darker green `142 76% 36%` | Success alerts, badges |
| `success-foreground` | Text on success backgrounds | Green-700 `142 76% 35%` | Light green `138 76% 97%` | Success text |
| `warning` | Warnings, caution | Yellow `38 92% 50%` | Brighter yellow `48 96% 53%` | Warning alerts |
| `warning-foreground` | Text on warning backgrounds | Yellow-600 `32 95% 44%` | Yellow-200 `48 96% 89%` | Warning text |
| `info` | Informational states | Blue `217 91% 60%` | Brighter blue `213 94% 68%` | Info alerts, badges |
| `info-foreground` | Text on info backgrounds | Blue-700 `221 83% 41%` | Light blue `214 100% 97%` | Info text |

### Additional Tokens

| Token | Purpose | Value |
|-------|---------|-------|
| `radius` | Border radius for rounded corners | `0.5rem` (8px) |
| `chart-1` to `chart-5` | Chart/graph colors | Varied palette for data visualization |

## When to Use Theme Tokens

### ✅ Always Use Theme Tokens For:

1. **Brand Colors**: Use `primary` for your main brand color instead of hardcoded purple/blue
2. **Text Colors**: Use `foreground`, `muted-foreground`, never hardcoded grays
3. **Backgrounds**: Use `background`, `card`, `muted`, `accent` for surfaces
4. **Borders**: Use `border` or `input` for all structural dividers
5. **Interactive States**: Use `accent` for hover states, `ring` for focus
6. **Semantic Feedback**: Use `success`, `warning`, `info`, `destructive` for status indicators

### ❌ Avoid:

1. **Hardcoded Tailwind Colors**: Don't use `bg-indigo-600`, `text-gray-500`, etc.
2. **Arbitrary Values**: Avoid `bg-[#7c3aed]` or similar arbitrary colors
3. **Brand-Specific Colors**: Don't hardcode company colors; use semantic tokens

## Using Theme Tokens in Custom Components

### Basic Usage

Replace hardcoded Tailwind color classes with semantic tokens:

```tsx
// ❌ Bad: Hardcoded colors
<div className="bg-white text-gray-900 border-gray-200">
  <button className="bg-indigo-600 text-white hover:bg-indigo-700">
    Click me
  </button>
</div>

// ✅ Good: Semantic tokens
<div className="bg-card text-card-foreground border-border">
  <button className="bg-primary text-primary-foreground hover:bg-primary/90">
    Click me
  </button>
</div>
```

### Opacity Modifiers

Leverage Tailwind's opacity modifiers with theme tokens:

```tsx
// Subtle backgrounds
<div className="bg-primary/10">  {/* 10% opacity primary */}
  
// Hover states
<button className="bg-primary hover:bg-primary/90"> {/* 90% opacity on hover */}

// Borders with transparency
<div className="border border-success/30"> {/* 30% opacity success border */}
```

### Component Variants

Use `class-variance-authority` (cva) to create semantic variants:

```tsx
import { cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
    },
  }
);
```

### Semantic Alerts Example

The `Alert` component demonstrates the "Smart Theming" pattern for semantic states:

```tsx
const alertVariants = cva("relative w-full rounded-md border p-4", {
  variants: {
    variant: {
      default: "bg-muted/50 border-border text-foreground",
      success: "bg-success/10 border-success/30 text-success-foreground",
      warning: "bg-warning/10 border-warning/30 text-warning-foreground",
      error: "bg-destructive/10 border-destructive/30 text-destructive-foreground",
      info: "bg-info/10 border-info/30 text-info-foreground",
    },
  },
});
```

Key patterns:
- **Neutral state**: Use `muted`, `border`, `foreground` tokens
- **Semantic backgrounds**: Use `{token}/10` for subtle backgrounds
- **Semantic borders**: Use `{token}/30` for visible but not overwhelming borders
- **Semantic text**: Use `{token}-foreground` for optimal contrast

### Toggle Component Example

The `Toggle` component shows dynamic state-based theming:

```tsx
<div className={cn(
  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
  checked ? "bg-primary" : "bg-input",
  disabled && "opacity-50 cursor-not-allowed"
)}>
  <span className={cn(
    "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
    checked ? "translate-x-6" : "translate-x-1"
  )} />
</div>
```

## Common Theming Patterns

### Pattern 1: Card with Header

```tsx
<div className="bg-card text-card-foreground border border-border rounded-lg">
  <div className="border-b border-border p-4">
    <h2 className="text-foreground font-semibold">Card Title</h2>
    <p className="text-muted-foreground text-sm">Subtitle or description</p>
  </div>
  <div className="p-4">
    {/* Card content */}
  </div>
</div>
```

### Pattern 2: Interactive List Item

```tsx
<button className="w-full text-left p-3 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
  <h3 className="font-medium">Item Title</h3>
  <p className="text-sm text-muted-foreground">Item description</p>
</button>
```

### Pattern 3: Form Input

```tsx
<input
  type="text"
  className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
  placeholder="Enter text..."
/>
```

### Pattern 4: Status Badge

```tsx
// Success badge
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success border border-success/30">
  Active
</span>

// Warning badge
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/30">
  Pending
</span>
```

### Pattern 5: Dropdown Menu

```tsx
<div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-popover border border-border">
  <div className="py-1">
    <button className="block w-full text-left px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground">
      Menu Item
    </button>
  </div>
</div>
```

## Migration Guide: Hardcoded to Semantic

| Old Hardcoded Class | New Semantic Token | Context |
|---------------------|-------------------|---------|
| `bg-indigo-600`, `bg-blue-600` | `bg-primary` | Brand/primary buttons |
| `text-indigo-600` | `text-primary` | Brand links, icons |
| `bg-white` | `bg-background` or `bg-card` | Page backgrounds, cards |
| `bg-gray-50` | `bg-muted/30` or `bg-accent/50` | Subtle backgrounds |
| `bg-gray-100` | `bg-muted` or `bg-accent` | Input backgrounds, secondary surfaces |
| `text-gray-900` | `text-foreground` | Primary text |
| `text-gray-600`, `text-gray-500` | `text-muted-foreground` | Secondary text, placeholders |
| `border-gray-200` | `border-border` | Subtle dividers |
| `border-gray-300` | `border-input` | Form field borders |
| `bg-red-600` | `bg-destructive` | Delete buttons, errors |
| `text-red-700`, `bg-red-50` | `text-destructive-foreground`, `bg-destructive/10` | Error states |
| `text-green-700`, `bg-green-50` | `text-success-foreground`, `bg-success/10` | Success states |
| `text-yellow-600`, `bg-yellow-50` | `text-warning-foreground`, `bg-warning/10` | Warning states |
| `text-blue-700`, `bg-blue-50` | `text-info-foreground`, `bg-info/10` | Info states |

## Theme Provider & Runtime Management

### Basic Setup

The `ThemeProvider` should wrap your application root:

```tsx
import { ThemeProvider } from "@checkmate-monitor/ui";

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <YourApp />
    </ThemeProvider>
  );
}
```

### Using the Theme Hook

Access and control the current theme:

```tsx
import { useTheme } from "@checkmate-monitor/ui";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
```

### Theme Persistence

Theme preferences are automatically persisted to the backend via the `theme-backend` plugin. When a user changes their theme preference:

1. The `ThemeProvider` updates the local state
2. The `theme-frontend` plugin syncs the preference to the backend
3. The preference is stored in the user's profile
4. The preference syncs across devices and browser sessions

## Testing Dark Mode

Always verify your components in both light and dark modes:

1. **Use the theme toggle** in the user menu (bottom-right)
2. **Check contrast**: Ensure text is readable on backgrounds
3. **Verify semantic colors**: Success/warning/error should be distinguishable
4. **Test interactive states**: Hover, focus, active states should be visible

## Best Practices

### DO:
- ✅ Use semantic token names (`bg-primary`, `text-foreground`)
- ✅ Leverage opacity modifiers (`bg-primary/10`, `hover:bg-accent/80`)
- ✅ Test in both light and dark modes
- ✅ Use `@checkmate-monitor/ui` components when possible (already theme-aware)
- ✅ Follow the established semantic patterns for your use case

### DON'T:
- ❌ Use hardcoded Tailwind color classes (`bg-indigo-600`)
- ❌ Use arbitrary color values (`bg-[#7c3aed]`)
- ❌ Override theme tokens with inline styles
- ❌ Assume colors will always look the same (dark mode changes them)
- ❌ Use semantic tokens for branding (e.g., don't use `destructive` for a red brand)

## Extending the Theme

If you need to add new tokens, follow this process:

1. **Define CSS variables** in `core/ui/src/themes.css` for both `:root` and `.dark`
2. **Map to Tailwind** in `tailwind.config.js` under `theme.extend.colors`
3. **Document the token** in this guide with usage guidelines
4. **Update components** to use the new token where appropriate

## Additional Resources

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [HSL Color Space](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl)
- [class-variance-authority](https://cva.style/docs)
- [Radix UI](https://www.radix-ui.com/) - Unstyled components used in `@checkmate-monitor/ui`
