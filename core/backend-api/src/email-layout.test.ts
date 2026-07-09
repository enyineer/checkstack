import { describe, expect, it } from "bun:test";
import { renderFooterText, wrapInEmailLayout } from "./email-layout";

const CHECKSTACK_LINK =
  '<a href="https://checkstack.dev" style="color: inherit; text-decoration: underline;">Checkstack</a>';

describe("renderFooterText", () => {
  it("links the Checkstack wordmark to the public site", () => {
    expect(renderFooterText("This is an automated notification from Checkstack.")).toBe(
      `This is an automated notification from ${CHECKSTACK_LINK}.`,
    );
  });

  it("leaves footer text without the wordmark untouched", () => {
    expect(renderFooterText("Sent by your monitoring platform")).toBe(
      "Sent by your monitoring platform",
    );
  });

  it("still escapes HTML in the surrounding text", () => {
    const rendered = renderFooterText('<script>alert("x")</script> from Checkstack');
    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain(CHECKSTACK_LINK);
  });
});

describe("wrapInEmailLayout footer", () => {
  it("renders the default footer with a Checkstack link", () => {
    const html = wrapInEmailLayout({
      title: "Test",
      bodyHtml: "<p>hi</p>",
      importance: "info",
    });
    expect(html).toContain(CHECKSTACK_LINK);
  });
});
