// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkGithubAdmonitions from "remark-github-admonitions-to-directives";

export default defineConfig({
  site: "https://enyineer.github.io",
  base: "/checkstack",
  // Convert GitHub-style alerts (`> [!NOTE]`, `> [!TIP]`, …) into Starlight's
  // `:::note` directives, so they render as Starlight `<Aside>` callouts
  // instead of literal blockquotes with a `[!TIP]` prefix.
  markdown: {
    remarkPlugins: [remarkGithubAdmonitions],
  },
  integrations: [
    starlight({
      title: "Checkstack",
      description: "Plugin-based application platform with extensible architecture.",
      logo: {
        src: "./src/assets/logo.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/checkstack.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/enyineer/checkstack",
        },
      ],
      components: {
        // Replace the default footer to add a Storybook link.
        Footer: "./src/components/Footer.astro",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/" },
            { slug: "getting-started/docker" },
            { slug: "getting-started/contributing" },
            { slug: "getting-started/plugin-development" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Backend",
          collapsed: true,
          autogenerate: { directory: "backend" },
        },
        {
          label: "Frontend",
          collapsed: true,
          autogenerate: { directory: "frontend" },
        },
        {
          label: "Common",
          autogenerate: { directory: "common" },
        },
        {
          label: "Security",
          collapsed: true,
          autogenerate: { directory: "security" },
        },
        {
          label: "Testing",
          collapsed: true,
          autogenerate: { directory: "testing" },
        },
        {
          label: "Examples",
          collapsed: true,
          autogenerate: { directory: "examples" },
        },
        {
          label: "Tooling",
          collapsed: true,
          autogenerate: { directory: "tooling" },
        },
        {
          label: "Design plans",
          collapsed: true,
          autogenerate: { directory: "plans" },
        },
        {
          label: "Component library",
          items: [
            {
              label: "Storybook",
              link: "/storybook/",
              attrs: { target: "_blank" },
            },
          ],
        },
      ],
    }),
  ],
});
