import { describe, it, expect } from "bun:test";
import { injectBootstrap, BOOTSTRAP_GLOBAL } from "./bootstrap-html";

const BASE_HTML = [
  "<!doctype html>",
  "<html>",
  "  <head>",
  "    <title>Checkstack</title>",
  '    <script type="module" crossorigin src="/entry.js"></script>',
  "  </head>",
  "  <body><div id=\"root\"></div></body>",
  "</html>",
].join("\n");

describe("injectBootstrap", () => {
  it("inserts the bootstrap script immediately before the module entry", () => {
    const out = injectBootstrap({
      html: BASE_HTML,
      bootstrap: {
        config: { baseUrl: "https://app.example.com" },
        enabledPlugins: [{ name: "@acme/widget-frontend", path: "/dist" }],
      },
    });

    const globalAt = out.indexOf(`window.${BOOTSTRAP_GLOBAL}`);
    const moduleAt = out.indexOf('<script type="module"');
    expect(globalAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);
    // The bootstrap global must run BEFORE the app entry module.
    expect(globalAt).toBeLessThan(moduleAt);
  });

  it("serializes config and enabledPlugins so the frontend can parse them", () => {
    const out = injectBootstrap({
      html: BASE_HTML,
      bootstrap: {
        config: {
          baseUrl: "https://status.acme.com",
          publicHost: { kind: "status-page", slug: "acme" },
        },
        enabledPlugins: [],
      },
    });

    const match = out.match(
      new RegExp(`window\\.${BOOTSTRAP_GLOBAL} = (.*?);</script>`),
    );
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1].replaceAll("\\u003c", "<"));
    expect(parsed).toEqual({
      config: {
        baseUrl: "https://status.acme.com",
        publicHost: { kind: "status-page", slug: "acme" },
      },
      enabledPlugins: [],
    });
  });

  it("escapes < so a value cannot break out of the script element", () => {
    const out = injectBootstrap({
      html: BASE_HTML,
      bootstrap: {
        config: { baseUrl: "https://app.example.com" },
        // A hostile/odd slug must not terminate the inline <script>.
        enabledPlugins: [{ name: "</script><script>alert(1)</script>", path: "/x" }],
      },
    });

    // The hostile value's tags must be escaped (every `<` is replaced with its
    // JSON unicode escape), never injected as raw markup that could break out of
    // our script element. Asserted directly (no tag-matching regex) so the check
    // itself can't be a half-built HTML filter.
    const esc = `${String.fromCodePoint(92)}u003c`; // the 6 chars: \ u 0 0 3 c
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain(`${esc}/script>`);
    expect(out).toContain(`${esc}script>alert(1)${esc}/script>`);
    // Still valid once unescaped.
    const match = out.match(
      new RegExp(`window\\.${BOOTSTRAP_GLOBAL} = (.*?);</script>`),
    );
    const parsed = JSON.parse(match![1].replaceAll("\\u003c", "<"));
    expect(parsed.enabledPlugins[0].name).toBe(
      "</script><script>alert(1)</script>",
    );
  });

  it("falls back to before </head> when there is no module script", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectBootstrap({
      html,
      bootstrap: { config: { baseUrl: "x" }, enabledPlugins: [] },
    });
    expect(out.indexOf(`window.${BOOTSTRAP_GLOBAL}`)).toBeLessThan(
      out.indexOf("</head>"),
    );
  });

  it("prepends when there is neither a module script nor a head", () => {
    const out = injectBootstrap({
      html: "<div>raw</div>",
      bootstrap: { config: { baseUrl: "x" }, enabledPlugins: [] },
    });
    expect(out.startsWith("<script>")).toBe(true);
  });
});
