// DOM setup FIRST: the package bunfig preloads this, but the ROOT runner does
// not - importing it here (idempotent) makes the test pass in both contexts.
import "@checkstack/test-utils-frontend/setup";
import { afterEach, describe, it, expect } from "bun:test";
import React, { useState } from "react";
import {
  render,
  fireEvent,
  act,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";

// The shared setup registers cleanup too, but CI's full-suite parallel runner
// has shown leaked DOM between this file's tests (a body-wide getByRole then
// matches the previous test's tree). Register it locally as well, and scope
// every query to the render's own container below, so the tests never depend
// on which runner context they execute in.
afterEach(cleanup);

import { DynamicForm } from "./DynamicForm";
import { DynamicOptionsField } from "./DynamicOptionsField";
import type { JsonSchema, OptionsResolver } from "./types";

/**
 * Regression guards for NUMBER-typed `x-options-resolver` fields (first
 * consumer: the log-stream pattern-metric collector's `variableIndex`).
 *
 * Two defects these pin down:
 *
 * 1. Value-type mismatch. Resolver options always carry STRING values
 *    (`ResolverOption.value`), but an `integer` field stores a NUMBER. Without
 *    coercion, picking "Variable 0" saved `variableIndex: "0"` (rejected by
 *    the backend's `z.number().int()`), and a stored numeric `0` never matched
 *    its option (`"0" !== 0`), rendering the picker as unselected.
 *
 * 2. Missing refetch on a sibling change. A resolver that reads a sibling
 *    field (the variable picker reads `patternId` from the same form) only
 *    re-fetches when that sibling is declared in `x-depends-on` - the fetch
 *    effect is deliberately keyed on the depends-on values only. The
 *    pattern-metric schema shipped without the declaration, so the options
 *    fetch ran exactly once at mount (patternId still empty) and the picker
 *    stayed "No options available" forever.
 */

const VARIABLE_OPTIONS = [
  { value: "0", label: "Variable 0 - samples: 12, 17" },
  { value: "2", label: "Variable 2 - samples: 3, 4" },
];

function renderNumericField({
  value,
  valueType,
  onChange,
}: {
  value: unknown;
  valueType?: "string" | "number" | "integer";
  onChange: (val?: unknown) => void;
}) {
  const resolvers: Record<string, OptionsResolver> = {
    vars: async () => VARIABLE_OPTIONS,
  };
  const { container } = render(
    <DynamicOptionsField
      id="variableIndex"
      label="VariableIndex"
      value={value}
      isRequired
      resolverName="vars"
      searchable
      valueType={valueType}
      formValues={{}}
      optionsResolvers={resolvers}
      onChange={onChange}
    />,
  );
  // Queries scoped to THIS render's container: render() returns body-wide
  // queries, which see any tree a previous test leaked into document.body.
  return within(container);
}

describe("DynamicOptionsField numeric value handling", () => {
  it("emits a NUMBER when an integer-typed field's option is picked", async () => {
    const emitted: unknown[] = [];
    const { getByRole, getByText } = renderNumericField({
      value: undefined,
      valueType: "integer",
      onChange: (val) => emitted.push(val),
    });

    // The searchable trigger only renders once options have loaded.
    await waitFor(() => {
      expect(getByRole("button").textContent).toContain("Select VariableIndex");
    });
    fireEvent.click(getByRole("button"));
    fireEvent.click(getByText("Variable 2 - samples: 3, 4"));

    // Strictly the number 2 - the string "2" fails the backend's z.number().
    expect(emitted).toEqual([2]);
  });

  it("shows a stored numeric 0 as the selected option", async () => {
    const { getByRole } = renderNumericField({
      value: 0,
      valueType: "integer",
      onChange: () => undefined,
    });

    // Without stringified matching, 0 never equals option value "0" and the
    // trigger would fall back to the "Select VariableIndex" placeholder.
    await waitFor(() => {
      expect(getByRole("button").textContent).toContain(
        "Variable 0 - samples: 12, 17",
      );
    });
  });

  it("keeps the string pass-through for fields without a numeric valueType", async () => {
    const emitted: unknown[] = [];
    const { getByRole, getByText } = renderNumericField({
      value: undefined,
      onChange: (val) => emitted.push(val),
    });

    await waitFor(() => {
      expect(getByRole("button").textContent).toContain("Select VariableIndex");
    });
    fireEvent.click(getByRole("button"));
    fireEvent.click(getByText("Variable 2 - samples: 3, 4"));

    expect(emitted).toEqual(["2"]);
  });
});

// ---------------------------------------------------------------------------
// Top-level sibling refetch (the pattern-metric `variableIndex` shape): the
// variable picker declares `x-depends-on: ["patternId"]`, so choosing a
// pattern re-runs the resolver with the fresh patternId. rowScopedOptions.tsx
// covers the per-array-row variant; this covers the flat-object one.
// ---------------------------------------------------------------------------

const patternMetricLikeSchema: JsonSchema = {
  type: "object",
  required: ["patternId", "variableIndex"],
  properties: {
    patternId: { type: "string" },
    variableIndex: {
      type: "integer",
      "x-options-resolver": "vars",
      "x-depends-on": ["patternId"],
    },
  },
};

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
  const [value, setValue] = useState<Record<string, unknown>>({});
  handleRef.current = { value, setValue };
  return (
    <DynamicForm
      schema={patternMetricLikeSchema}
      value={value}
      onChange={setValue}
      optionsResolvers={resolvers}
    />
  );
}

describe("DynamicForm sibling-dependent options (pattern-metric regression)", () => {
  it("re-fetches variable options when the sibling patternId is chosen", async () => {
    const seenPatternIds: unknown[] = [];
    const resolvers: Record<string, OptionsResolver> = {
      vars: async (formValues) => {
        seenPatternIds.push(formValues.patternId);
        if (typeof formValues.patternId !== "string") return [];
        return VARIABLE_OPTIONS;
      },
    };
    const handleRef: { current: FormHandle | null } = { current: null };
    render(<Harness resolvers={resolvers} handleRef={handleRef} />);

    // Mount fetch runs with no pattern chosen yet -> no options.
    await waitFor(() => {
      expect(seenPatternIds).toContain(undefined);
    });

    // Choose a pattern through the controlled onChange contract (this rig
    // cannot deliver text-input change events; see rowScopedOptions.test.tsx).
    act(() => {
      handleRef.current?.setValue((prev) => ({ ...prev, patternId: "p-1" }));
    });

    // The declared x-depends-on triggers a refetch that now sees the pattern.
    // Without the declaration the resolver is never called again (the bug).
    await waitFor(() => {
      expect(seenPatternIds).toContain("p-1");
    });
  });
});
