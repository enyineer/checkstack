import type { Preview } from "@storybook/react";
import { withThemeByClassName } from "@storybook/addon-themes";
import React from "react";
import { MemoryRouter } from "react-router";
import {
  ApiRegistryBuilder,
  ApiProvider,
  accessApiRef,
} from "@checkstack/frontend-api";
import { ThemeProvider } from "../src/components/ThemeProvider";
import { ToastProvider } from "../src/components/ToastProvider";
import { PerformanceProvider } from "../src/components/PerformanceProvider";
import { mockAccessApi } from "./mock-access-api";
import "./preview.css";

const apiRegistry = new ApiRegistryBuilder()
  .register(accessApiRef, mockAccessApi)
  .build();

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "app",
      values: [
        { name: "app", value: "hsl(0 0% 100%)" },
        { name: "app-dark", value: "hsl(240 10% 4%)" },
      ],
    },
    layout: "padded",
    options: {
      storySort: {
        order: [
          "Introduction",
          "Foundations",
          "Components",
          ["Inputs", "Display", "Feedback", "Navigation", "Overlays", "Forms", "Layout", "Data"],
        ],
      },
    },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "light",
    }),
    (Story) => (
      <MemoryRouter>
        <ApiProvider registry={apiRegistry}>
          <ThemeProvider defaultTheme="light" storageKey="checkstack-storybook-theme">
            <ToastProvider>
              <PerformanceProvider>
                <div className="bg-background text-foreground p-4">
                  <Story />
                </div>
              </PerformanceProvider>
            </ToastProvider>
          </ThemeProvider>
        </ApiProvider>
      </MemoryRouter>
    ),
  ],
};

export default preview;
