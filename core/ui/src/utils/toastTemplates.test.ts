import { describe, expect, it, mock, beforeEach } from "bun:test";
import {
  toastError,
  toastSuccess,
  type ToastApi,
} from "./toastTemplates";

const makeToastMock = (): ToastApi => ({
  show: mock(),
  success: mock(),
  error: mock(),
  warning: mock(),
  info: mock(),
});

describe("toastSuccess", () => {
  let toast: ToastApi;

  beforeEach(() => {
    toast = makeToastMock();
  });

  it("passes the action through to toast.success", () => {
    toastSuccess(toast, "Check created");

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Check created");
  });
});

describe("toastError", () => {
  let toast: ToastApi;

  beforeEach(() => {
    toast = makeToastMock();
  });

  it("prefixes the action and includes the extracted error message", () => {
    toastError(toast, "Failed to create check", new Error("Backend unreachable"));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to create check: Backend unreachable",
    );
  });

  it("uses the fallback message when error is not an Error or string", () => {
    toastError(toast, "Failed to delete check", null);

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to delete check: An error occurred",
    );
  });

  it("accepts a string error and includes it verbatim", () => {
    toastError(toast, "Save failed", "validation: bad payload");

    expect(toast.error).toHaveBeenCalledWith(
      "Save failed: validation: bad payload",
    );
  });

  it("truncates the message to 100 characters with an ellipsis", () => {
    const longMessage = "x".repeat(200);
    toastError(toast, "Failed", new Error(longMessage));

    const mockedError = toast.error as ReturnType<typeof mock>;
    const call = mockedError.mock.calls[0];
    const arg = call[0];
    expect(typeof arg).toBe("string");
    if (typeof arg !== "string") throw new Error("expected string toast message");
    expect(arg.length).toBe(100);
    expect(arg.endsWith("…")).toBe(true);
  });

  it("leaves messages at or under 100 characters intact", () => {
    const shortMessage = "boom";
    toastError(toast, "Failed", new Error(shortMessage));

    expect(toast.error).toHaveBeenCalledWith("Failed: boom");
  });
});
