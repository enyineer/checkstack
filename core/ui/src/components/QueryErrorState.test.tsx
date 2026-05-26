import { describe, expect, it, mock } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render } from "@checkstack/test-utils-frontend";
import { QueryErrorState } from "./QueryErrorState";

describe("QueryErrorState", () => {
  it("renders the extracted error message", () => {
    const { getByText } = render(
      <QueryErrorState
        error={new Error("Backend unreachable")}
        onRetry={() => undefined}
      />,
    );

    expect(getByText("Backend unreachable")).toBeDefined();
    expect(getByText("Something went wrong")).toBeDefined();
  });

  it("personalises the headline when a resource is supplied", () => {
    const { getByText } = render(
      <QueryErrorState
        error={new Error("boom")}
        onRetry={() => undefined}
        resource="checks"
      />,
    );

    expect(getByText("Could not load checks")).toBeDefined();
  });

  it("invokes onRetry when the Retry button is clicked", () => {
    const onRetry = mock(() => undefined);

    const { getByRole } = render(
      <QueryErrorState error={new Error("nope")} onRetry={onRetry} />,
    );

    fireEvent.click(getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default message when error is not an Error", () => {
    const { getByText } = render(
      <QueryErrorState error={null} onRetry={() => undefined} />,
    );

    expect(getByText("An error occurred")).toBeDefined();
  });
});
