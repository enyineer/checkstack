import { render } from "@checkstack/test-utils-frontend";
import { SubscribeButton } from "./SubscribeButton";
import { describe, it, expect, vi } from "bun:test";

describe("SubscribeButton", () => {
  it("renders with correct accessibility attributes (improved)", () => {
    const onSubscribe = vi.fn();
    const onUnsubscribe = vi.fn();

    const { getByRole, rerender } = render(
      <SubscribeButton
        isSubscribed={false}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
      />,
    );

    let button = getByRole("button");
    // Should have aria-label matching title
    expect(button.getAttribute("aria-label")).toBe(
      "Subscribe to notifications",
    );
    // Should have aria-pressed
    expect(button.getAttribute("aria-pressed")).toBe("false");

    // Test subscribed state
    rerender(
      <SubscribeButton
        isSubscribed={true}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
      />,
    );
    button = getByRole("button");
    expect(button.getAttribute("aria-label")).toBe(
      "Unsubscribe from notifications",
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");

    // Test loading state when subscribing
    rerender(
      <SubscribeButton
        isSubscribed={false}
        loading={true}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
      />,
    );
    button = getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("Subscribing...");
    // Check for spinner
    const spinner = getByRole("status");
    expect(spinner.getAttribute("aria-label")).toBe("Loading");

    // Test loading state when unsubscribing
    rerender(
      <SubscribeButton
        isSubscribed={true}
        loading={true}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
      />,
    );
    button = getByRole("button");
    expect(button.getAttribute("aria-label")).toBe("Unsubscribing...");
  });
});
