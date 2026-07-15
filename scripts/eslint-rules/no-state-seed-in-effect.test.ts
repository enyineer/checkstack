import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noStateSeedInEffect } from "./no-state-seed-in-effect.mjs";

// Drive ESLint's RuleTester through bun:test's describe/it so failures surface
// as normal test cases (RuleTester calls these statics internally).
RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("no-state-seed-in-effect", noStateSeedInEffect, {
  valid: [
    // Reset-to-constant on open: no setter reads a dependency, so `open` is a
    // pure guard. This is the safe SearchDialog/SecretEditor shape.
    {
      code: `useEffect(() => { if (!open) { setQuery(""); setTab("actions"); } }, [open]);`,
    },
    // Reset value to empty string, keyed on open only.
    {
      code: `useEffect(() => { if (open) { setValue(""); } }, [open]);`,
    },
    // Empty deps -> runs once on mount, cannot re-seed a live form.
    {
      code: `useEffect(() => { setName(initialData?.name ?? ""); }, []);`,
    },
    // No deps array at all -> different concern, not this rule.
    {
      code: `useEffect(() => { setName(initialData?.name ?? ""); });`,
    },
    // Body does real work (a subscription), not a pure seed.
    {
      code: `useEffect(() => { const sub = bus.subscribe(fn); setReady(true); return () => sub(); }, [bus]);`,
    },
    // The sanctioned replacement hook is not a useEffect and is never flagged.
    {
      code: `useSeedFormOnOpen(open, () => { setName(initialData?.name ?? ""); });`,
    },
    // useInitOnceForKey (custom hook) is not an effect hook.
    {
      code: `useInitOnceForKey(data, data?.id, (d) => setDraft(d));`,
    },
    // Functional updater that prunes/merges against a dep PRESERVES existing
    // state (IncidentConfigPage/MaintenanceConfigPage shape) - not a re-seed.
    {
      code: `useEffect(() => { setSelectedIds((prev) => new Set(prune(prev, selectableIds))); }, [selectableIds]);`,
    },
  ],
  invalid: [
    // The catalog SystemEditor / EnvironmentEditor bug: seed from initialData,
    // keyed on [open, initialData].
    {
      code: `useEffect(() => { if (open) { setName(initialData?.name ?? ""); setFields(rows(initialData?.metadata)); } }, [open, initialData]);`,
      errors: [{ messageId: "seedInEffect", data: { dep: "initialData" } }],
    },
    // The PlatformDefaultsDialog bug: seed draft from query data, keyed on [data].
    {
      code: `useEffect(() => { if (data) setDraft(data); }, [data]);`,
      errors: [{ messageId: "seedInEffect", data: { dep: "data" } }],
    },
    // Implicit-return arrow that seeds directly from a dep.
    {
      code: `useEffect(() => setDraft(data), [data]);`,
      errors: [{ messageId: "seedInEffect", data: { dep: "data" } }],
    },
    // React.useEffect member form is handled too.
    {
      code: `React.useEffect(() => { setTitle(announcement?.title ?? ""); }, [open, announcement]);`,
      errors: [{ messageId: "seedInEffect", data: { dep: "announcement" } }],
    },
  ],
});
