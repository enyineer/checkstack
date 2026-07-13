// DOM setup FIRST: the package bunfig preloads this, but the ROOT runner does
// not - importing it here (idempotent) makes the test pass in both contexts.
import "@checkstack/test-utils-frontend/setup";
import { describe, it, expect } from "bun:test";
import React, { useState } from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react";

import { DynamicForm } from "./DynamicForm";
import type { JsonSchema, OptionsResolver } from "./types";

/**
 * Rendering/interaction guard for DynamicForm's ROW-SCOPED resolver values.
 *
 * FormField's array branch feeds `scopeArrayItemFormValues({ formValues, item })`
 * (utils.ts) into each per-row object, so a row field's `x-options-resolver` and
 * `x-depends-on` read that row's OWN sibling values merged OVER the whole-form
 * values. The metricstream check editor's `labelFilters` ([{ key, value }] where
 * a row's `value` options depend on the row's `key` plus the top-level
 * `metricName`) is the first consumer.
 *
 * The mis-wire this catches: forwarding the OUTER `formValues` into the row would
 * still render everything, but a row's `value` resolver would never see its own
 * `key` (the top level has no `key`), so every row's value dropdown would fetch
 * with an undefined key - and row 2 could silently fetch with row 1's key. Pure
 * helper tests and a non-asserting story cannot catch that; only mounting the
 * real form and capturing the value resolver's call args per row can.
 *
 * Interaction model. This suite mounts the REAL DynamicForm and its real effects
 * (the `value` field's `DynamicOptionsField` fetches through a useEffect keyed on
 * its `x-depends-on` values). Rows are added with a genuine DOM `click` on the
 * "Add Item" button. A row's `key` is then set through the controlled `onChange`
 * contract - the exact `setState` channel the key field's own `onChange` calls -
 * because this React 19 + happy-dom test rig cannot deliver a text-input change
 * event (React's input value-tracker does not install over happy-dom's input, so
 * `onChange` never fires for typed text; `click` events DO fire, which is why the
 * add-row interaction is a real event). Driving the key via the controlled value
 * exercises the identical code path under test: array item ->
 * `scopeArrayItemFormValues` merge -> object branch forwarding the merged
 * `formValues` -> the `value` field's resolver + depends-on refetch.
 */

const schema: JsonSchema = {
  type: "object",
  required: ["metricName"],
  properties: {
    metricName: { type: "string" },
    labelFilters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          // The field under test: its options depend on the row's OWN key
          // (row-scoped) AND the whole-form metricName.
          value: {
            type: "string",
            "x-options-resolver": "values",
            "x-depends-on": ["metricName", "key"],
          },
        },
      },
    },
  },
};

/** A single captured invocation of the `values` resolver. */
type ValueCall = { metricName: unknown; key: unknown };

function buildResolvers(calls: ValueCall[]): Record<string, OptionsResolver> {
  return {
    // Records the (row-scoped) formValues it was handed, then returns options
    // derived from the row's key so the shape mirrors the real consumer.
    values: async (formValues) => {
      calls.push({ metricName: formValues.metricName, key: formValues.key });
      const key = String(formValues.key ?? "");
      if (!key) return [];
      return [
        { value: `${key}=a`, label: `${key}=a` },
        { value: `${key}=b`, label: `${key}=b` },
      ];
    },
  };
}

/** Handle the test uses to read/replace the controlled form value. */
type FormHandle = {
  value: Record<string, unknown>;
  setValue: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
};

function Harness({
  resolvers,
  handleRef,
}: {
  resolvers: Record<string, OptionsResolver>;
  handleRef: { current: FormHandle | null };
}) {
  const [value, setValue] = useState<Record<string, unknown>>({
    metricName: "http_requests_total",
  });
  handleRef.current = { value, setValue };
  return (
    <DynamicForm
      schema={schema}
      value={value}
      onChange={setValue}
      optionsResolvers={resolvers}
    />
  );
}

/** Replace the value at labelFilters[index].key, as the key input's onChange would. */
function setRowKey({
  handle,
  index,
  key,
}: {
  handle: FormHandle;
  index: number;
  key: string;
}): void {
  act(() => {
    handle.setValue((prev) => {
      const rows = [...((prev.labelFilters as unknown[]) ?? [])];
      rows[index] = { ...(rows[index] as Record<string, unknown>), key };
      return { ...prev, labelFilters: rows };
    });
  });
}

/** How many times the resolver was invoked for a specific row key. */
const callsForKey = (calls: ValueCall[], key: string): number =>
  calls.filter((c) => c.key === key).length;

describe("DynamicForm row-scoped resolver values", () => {
  it("invokes each row's value resolver with THAT row's own key + the whole-form metric", async () => {
    const calls: ValueCall[] = [];
    const handleRef: { current: FormHandle | null } = { current: null };
    const { getAllByRole } = render(
      <Harness resolvers={buildResolvers(calls)} handleRef={handleRef} />,
    );
    const handle = () => {
      if (!handleRef.current) throw new Error("harness not mounted");
      return handleRef.current;
    };

    // Add two rows via a real DOM click on the array's "Add Item" button.
    fireEvent.click(getAllByRole("button", { name: /add item/i })[0]);
    fireEvent.click(getAllByRole("button", { name: /add item/i })[0]);

    // Give each row its OWN distinct key.
    setRowKey({ handle: handle(), index: 0, key: "method" });
    setRowKey({ handle: handle(), index: 1, key: "code" });

    // Row scoping proven: the shared resolver was handed BOTH distinct row keys,
    // each alongside the whole-form metric. Under the outer-formValues mis-wire
    // the top level has no `key`, so no call could ever carry "method"/"code".
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.key === "method" && c.metricName === "http_requests_total",
        ),
      ).toBe(true);
      expect(
        calls.some(
          (c) => c.key === "code" && c.metricName === "http_requests_total",
        ),
      ).toBe(true);
    });
  });

  it("re-fetches only the edited row's values on an x-depends-on key change", async () => {
    const calls: ValueCall[] = [];
    const handleRef: { current: FormHandle | null } = { current: null };
    const { getAllByRole } = render(
      <Harness resolvers={buildResolvers(calls)} handleRef={handleRef} />,
    );
    const handle = () => {
      if (!handleRef.current) throw new Error("harness not mounted");
      return handleRef.current;
    };

    fireEvent.click(getAllByRole("button", { name: /add item/i })[0]);
    fireEvent.click(getAllByRole("button", { name: /add item/i })[0]);
    setRowKey({ handle: handle(), index: 0, key: "method" });
    setRowKey({ handle: handle(), index: 1, key: "code" });

    // Wait until both rows have fetched at their initial keys.
    await waitFor(() => {
      expect(callsForKey(calls, "method")).toBeGreaterThanOrEqual(1);
      expect(callsForKey(calls, "code")).toBeGreaterThanOrEqual(1);
    });

    const codeCallsBefore = callsForKey(calls, "code");

    // Change ONLY row 0's key. Row 0's value resolver depends on `key`, so it
    // must re-fetch with the new key; row 1's depends-on values are unchanged,
    // so it must NOT re-fetch.
    setRowKey({ handle: handle(), index: 0, key: "latency" });

    await waitFor(() => {
      expect(callsForKey(calls, "latency")).toBeGreaterThanOrEqual(1);
    });

    // Row 1 ("code") was not re-fetched by row 0's edit. (A broken dependency
    // scope - reading the outer formValues - would refetch nothing at all,
    // failing the assertion above, or refetch every row here.)
    expect(callsForKey(calls, "code")).toBe(codeCallsBefore);
  });
});
