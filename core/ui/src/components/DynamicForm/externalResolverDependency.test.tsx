// DOM setup FIRST: the package bunfig preloads this, but the ROOT runner does
// not - importing it here (idempotent) makes the test pass in both contexts.
import "@checkstack/test-utils-frontend/setup";
import { describe, it, expect } from "bun:test";
import React, { useRef, useState } from "react";
import { render, act, waitFor } from "@testing-library/react";

import { DynamicForm } from "./DynamicForm";
import type { JsonSchema, OptionsResolver, ResolverOption } from "./types";

/**
 * Guard for DynamicForm's EXTERNAL resolver dependency (`resolversDependencyKey`).
 *
 * A cross-form picker resolves against state that is NOT part of its own form:
 * the health-check editor's COLLECTOR pickers (tracestream's service / span-name
 * dropdowns, logstream's pattern / variable dropdowns) read the `streamId`
 * chosen in the sibling STRATEGY form. `x-depends-on` can only name a field in
 * the SAME form, so it cannot express that dependency - the field would keep the
 * previous stream's options until the form happened to re-mount.
 *
 * `resolversDependencyKey` (a fingerprint of that external state, threaded by the
 * host) is added to the fetch effect's dependencies, so the picker re-fetches
 * when the external selection changes WITHOUT any re-mount. This suite mounts the
 * real DynamicForm and its real fetch effect and drives the key while the form
 * stays mounted, which the incidental-remount behavior could otherwise mask.
 */

const schema: JsonSchema = {
  type: "object",
  properties: {
    // The cross-form picker: resolves against the externally-chosen stream, so
    // it declares NO `x-depends-on` (there is no sibling field to name).
    serviceName: { type: "string", "x-options-resolver": "services" },
    // An unrelated sibling, used to prove an in-form edit does not churn the
    // picker when the external key is unchanged.
    note: { type: "string" },
  },
};

/** One captured invocation of the `services` resolver. */
type ServiceCall = { streamId: string };

/**
 * Resolver that reads the external `streamId` at CALL time (via a ref, exactly
 * as the health-check editor's stable resolver proxy does) and returns options
 * derived from it, recording each call's stream.
 */
function buildResolvers({
  streamIdRef,
  calls,
}: {
  streamIdRef: { current: string };
  calls: ServiceCall[];
}): Record<string, OptionsResolver> {
  return {
    services: async (): Promise<ResolverOption[]> => {
      const streamId = streamIdRef.current;
      calls.push({ streamId });
      return [{ value: `${streamId}-svc`, label: `${streamId}-svc` }];
    },
  };
}

type Handle = {
  setStreamId: React.Dispatch<React.SetStateAction<string>>;
  setValue: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
};

function Harness({
  calls,
  handleRef,
}: {
  calls: ServiceCall[];
  handleRef: { current: Handle | null };
}) {
  const [streamId, setStreamId] = useState("streamA");
  const [value, setValue] = useState<Record<string, unknown>>({});
  // Latest external stream, read by the resolver at call time.
  const streamIdRef = useRef(streamId);
  streamIdRef.current = streamId;
  handleRef.current = { setStreamId, setValue };
  // Stable resolvers object (identity read via ref inside the field); the
  // resolver still observes the latest stream through `streamIdRef`.
  const resolvers = React.useMemo(
    () => buildResolvers({ streamIdRef, calls }),
    [calls],
  );
  return (
    <DynamicForm
      schema={schema}
      value={value}
      onChange={setValue}
      optionsResolvers={resolvers}
      // Fingerprint of the EXTERNAL strategy selection this collector picker
      // depends on. Changing the stream changes this key.
      resolversDependencyKey={streamId}
    />
  );
}

const callsForStream = (calls: ServiceCall[], streamId: string): number =>
  calls.filter((c) => c.streamId === streamId).length;

describe("DynamicForm external resolver dependency", () => {
  const mount = () => {
    const calls: ServiceCall[] = [];
    const handleRef: { current: Handle | null } = { current: null };
    render(<Harness calls={calls} handleRef={handleRef} />);
    const handle = () => {
      if (!handleRef.current) throw new Error("harness not mounted");
      return handleRef.current;
    };
    return { calls, handle };
  };

  it("re-fetches the picker when the external dependency key changes (stream switch)", async () => {
    const { calls, handle } = mount();

    // Initial mount fetches against the first stream.
    await waitFor(() => {
      expect(callsForStream(calls, "streamA")).toBeGreaterThanOrEqual(1);
    });

    // Switch the externally-chosen stream. The picker has no `x-depends-on`, so
    // ONLY the changed `resolversDependencyKey` can drive this refetch - and it
    // must, with the NEW stream, while the form stays mounted.
    act(() => {
      handle().setStreamId("streamB");
    });

    await waitFor(() => {
      expect(callsForStream(calls, "streamB")).toBeGreaterThanOrEqual(1);
    });
  });

  it("does NOT re-fetch on an unrelated in-form edit when the key is unchanged", async () => {
    const { calls, handle } = mount();

    await waitFor(() => {
      expect(callsForStream(calls, "streamA")).toBeGreaterThanOrEqual(1);
    });
    const before = calls.length;

    // Edit an unrelated sibling field. `value` changes (re-render), but the
    // picker declares no `x-depends-on` and the external key is unchanged, so it
    // must NOT refetch - the ref-read resolvers identity + stable key hold it.
    await act(async () => {
      handle().setValue((prev) => ({ ...prev, note: "changed" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(calls.length).toBe(before);
  });
});
