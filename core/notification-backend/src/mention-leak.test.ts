import { describe, expect, it } from "bun:test";
import { buildMentionMarkdown } from "@checkstack/common";
import { buildUpdateMessageSuffix } from "@checkstack/notification-common";
import {
  markdownToHtml,
  markdownToPlainText,
  markdownToSlackMrkdwn,
} from "@checkstack/backend-api";

/**
 * Cross-channel guard: an authored `#` mention must never reach a recipient as
 * the internal `checkstack:` scheme.
 *
 * This lives here, above BOTH the sanitizer and the channel converters, because
 * neither side can catch the bug alone. `update-message.test.ts` proves the
 * sanitizer strips the scheme; `markdown.test.ts` proves each converter is
 * faithful. Only their COMPOSITION shows what a recipient actually sees - and
 * that is where the original defect lived:
 *
 * | Channel | Before this fix                                      |
 * |---------|------------------------------------------------------|
 * | Email   | `<a>Database upgrade</a>` - href stripped, dead link  |
 * | Text    | `Database upgrade` - fine by luck                     |
 * | Slack   | `<checkstack:maintenance/9f1c-abc\|Database upgrade>` |
 *
 * Slack leaked the internal URI outright, and the markdown-native channels
 * (Discord, Telegram, Teams) pass the body through unchanged, so they would
 * have too. Each converter was behaving correctly; the body was wrong.
 */
describe("notification bodies never leak the internal mention scheme", () => {
  const bodyWith = (message: string) =>
    'Incident **"API outage"** has been updated.' +
    buildUpdateMessageSuffix({ message });

  const channels = {
    "email (HTML)": markdownToHtml,
    "plain text (SMS/push)": markdownToPlainText,
    "slack (mrkdwn)": markdownToSlackMrkdwn,
  };

  const rendered = (body: string) =>
    Object.entries(channels).map(
      ([name, convert]) => [name, convert(body)] as const,
    );

  it("strips the scheme in EVERY channel while keeping the label", () => {
    const body = bodyWith(
      `Rolled back. See ${buildMentionMarkdown({
        type: "maintenance",
        id: "9f1c-abc",
        label: "Database upgrade",
      })}.`,
    );

    for (const [name, out] of rendered(body)) {
      expect(out, `${name} must not carry the internal scheme`).not.toContain(
        "checkstack:",
      );
      expect(out, `${name} must still show the label`).toContain(
        "Database upgrade",
      );
    }
  });

  it("holds for several mentions of different types in one body", () => {
    const body = bodyWith(
      [
        buildMentionMarkdown({ type: "incident", id: "i1", label: "Outage" }),
        buildMentionMarkdown({ type: "maintenance", id: "m1", label: "Window" }),
      ].join(" and also "),
    );

    for (const [name, out] of rendered(body)) {
      expect(out, name).not.toContain("checkstack:");
      expect(out, name).toContain("Outage");
      expect(out, name).toContain("Window");
    }
  });

  it("holds for a hostile label that embeds the scheme itself", () => {
    const body = bodyWith(
      buildMentionMarkdown({
        type: "incident",
        id: "real",
        label: "evil](checkstack:incident/injected) tail",
      }),
    );

    // The label is the author's own text and is escaped, so it cannot form a
    // link - but the rendered output must still not present a usable internal
    // URI as a link destination in any channel.
    for (const [name, out] of rendered(body)) {
      expect(out, `${name} must not link the injected reference`).not.toMatch(
        /href="checkstack:|<checkstack:/,
      );
    }
  });

  it("still delivers ordinary links, which the mention fix must not break", () => {
    // The bug this feature originally fixed: authored links arriving escaped.
    const body = bodyWith("See [the runbook](https://example.com/rb).");

    expect(markdownToHtml(body)).toContain('href="https://example.com/rb"');
    expect(markdownToSlackMrkdwn(body)).toContain("https://example.com/rb");
    expect(markdownToPlainText(body)).toContain("the runbook");
  });
});
