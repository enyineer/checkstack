import checkstackPreset from "./tailwind-preset.js";

/** @type {import('tailwindcss').Config} */
export default {
  // Theme tokens + tailwindcss-animate live in the shared preset (also
  // exported as `@checkstack/frontend/tailwind-preset`). Only `content`
  // is app-specific.
  presets: [checkstackPreset],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    // Core frontend plugins (siblings in core/)
    "../*-frontend/src/**/*.{js,ts,jsx,tsx}",
    // External plugins
    "../../plugins/*-frontend/src/**/*.{js,ts,jsx,tsx}",
    // Shared UI library
    "../ui/src/**/*.{js,ts,jsx,tsx}",
  ],
};
