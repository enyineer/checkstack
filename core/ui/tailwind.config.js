import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./.storybook/**/*.{js,ts,jsx,tsx,mdx,html}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // Surface elevation ramp (bg < surface < surface-2 < surface-inset).
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
          2: "hsl(var(--surface-2))",
          inset: "hsl(var(--surface-inset))",
        },
        // Aurora signature gradient stops (teal -> violet -> magenta).
        aurora: {
          1: "hsl(var(--aurora-1))",
          2: "hsl(var(--aurora-2))",
          3: "hsl(var(--aurora-3))",
        },
        // Colorblind-safe status triad (hue + luminance separated).
        status: {
          ok: {
            DEFAULT: "hsl(var(--status-ok))",
            foreground: "hsl(var(--status-ok-foreground))",
          },
          warn: {
            DEFAULT: "hsl(var(--status-warn))",
            foreground: "hsl(var(--status-warn-foreground))",
          },
          down: {
            DEFAULT: "hsl(var(--status-down))",
            foreground: "hsl(var(--status-down-foreground))",
          },
          unknown: {
            DEFAULT: "hsl(var(--status-unknown))",
            foreground: "hsl(var(--status-unknown-foreground))",
          },
        },
        "grid-line": "hsl(var(--grid-line))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
