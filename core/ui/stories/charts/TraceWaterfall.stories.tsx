import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import {
  TraceWaterfall,
  type WaterfallSpan,
} from "../../src/components/charts";

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

/**
 * A realistic checkout trace: an HTTP server root fans out to auth, a DB query,
 * a downstream inventory RPC (which itself queries a DB), and a payment call
 * that fails - so the fixture exercises nesting, multiple services and an error
 * span on the critical path.
 */
const checkoutTrace: WaterfallSpan[] = [
  {
    spanId: "root",
    parentSpanId: null,
    name: "POST /checkout",
    serviceName: "api-gateway",
    kind: "server",
    startTs: T0,
    durationMs: 840,
    statusCode: "error",
  },
  {
    spanId: "auth",
    parentSpanId: "root",
    name: "verify-session",
    serviceName: "auth-service",
    kind: "client",
    startTs: T0 + 10,
    durationMs: 60,
    statusCode: "ok",
  },
  {
    spanId: "cart-db",
    parentSpanId: "root",
    name: "SELECT cart_items",
    serviceName: "postgres",
    kind: "client",
    startTs: T0 + 80,
    durationMs: 45,
    statusCode: "ok",
  },
  {
    spanId: "inventory",
    parentSpanId: "root",
    name: "GET /inventory/reserve",
    serviceName: "inventory-service",
    kind: "client",
    startTs: T0 + 130,
    durationMs: 260,
    statusCode: "ok",
  },
  {
    spanId: "inventory-db",
    parentSpanId: "inventory",
    name: "UPDATE stock",
    serviceName: "postgres",
    kind: "client",
    startTs: T0 + 160,
    durationMs: 190,
    statusCode: "ok",
  },
  {
    spanId: "inventory-cache",
    parentSpanId: "inventory",
    name: "SET reservation",
    serviceName: "redis",
    kind: "client",
    startTs: T0 + 360,
    durationMs: 8,
    statusCode: "ok",
  },
  {
    spanId: "payment",
    parentSpanId: "root",
    name: "POST /charge",
    serviceName: "payment-service",
    kind: "client",
    startTs: T0 + 400,
    durationMs: 430,
    statusCode: "error",
  },
  {
    spanId: "payment-gateway",
    parentSpanId: "payment",
    name: "stripe.charge",
    serviceName: "payment-service",
    kind: "client",
    startTs: T0 + 420,
    durationMs: 405,
    statusCode: "error",
  },
];

const meta: Meta<typeof TraceWaterfall> = {
  title: "Charts/TraceWaterfall",
  component: TraceWaterfall,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof TraceWaterfall>;

export const CheckoutWithError: Story = {
  args: { spans: checkoutTrace, heightClassName: "h-[20rem]" },
};

/** Selection is controlled by the parent; clicking a row updates it. */
const SelectableDemo: React.FC = () => {
  const [selected, setSelected] = useState<string | null>("payment-gateway");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Selected span: <span className="font-mono">{selected ?? "none"}</span>
      </p>
      <TraceWaterfall
        spans={checkoutTrace}
        selectedSpanId={selected}
        onSpanClick={setSelected}
        heightClassName="h-[20rem]"
      />
    </div>
  );
};

export const Selectable: Story = {
  render: () => <SelectableDemo />,
};

/** Orphan spans (parent not captured) are promoted to the root level. */
export const OrphanSpans: Story = {
  args: {
    heightClassName: "h-[14rem]",
    spans: [
      {
        spanId: "orphan-a",
        parentSpanId: "never-shipped",
        name: "consume order.created",
        serviceName: "email-worker",
        kind: "consumer",
        startTs: T0,
        durationMs: 120,
        statusCode: "ok",
      },
      {
        spanId: "orphan-a-child",
        parentSpanId: "orphan-a",
        name: "render template",
        serviceName: "email-worker",
        kind: "internal",
        startTs: T0 + 10,
        durationMs: 30,
        statusCode: "ok",
      },
      {
        spanId: "orphan-b",
        parentSpanId: "also-missing",
        name: "consume order.created",
        serviceName: "audit-worker",
        kind: "consumer",
        startTs: T0 + 40,
        durationMs: 60,
        statusCode: "ok",
      },
    ],
  },
};

/** A deep, wide synthetic trace to show virtualization + collapse at scale. */
export const LargeTrace: Story = {
  args: {
    heightClassName: "h-[26rem]",
    spans: buildLargeTrace(),
  },
};

function buildLargeTrace(): WaterfallSpan[] {
  const spans: WaterfallSpan[] = [
    {
      spanId: "root",
      parentSpanId: null,
      name: "GET /dashboard",
      serviceName: "web",
      kind: "server",
      startTs: T0,
      durationMs: 1200,
      statusCode: "ok",
    },
  ];
  const services = ["web", "api", "postgres", "redis", "search"];
  for (let group = 0; group < 12; group += 1) {
    const parentId = `grp-${group}`;
    spans.push({
      spanId: parentId,
      parentSpanId: "root",
      name: `widget-${group}`,
      serviceName: services[group % services.length]!,
      kind: "internal",
      startTs: T0 + group * 90,
      durationMs: 180,
      statusCode: group === 7 ? "error" : "ok",
    });
    for (let child = 0; child < 6; child += 1) {
      spans.push({
        spanId: `${parentId}-c${child}`,
        parentSpanId: parentId,
        name: `query-${child}`,
        serviceName: services[(group + child) % services.length]!,
        kind: "client",
        startTs: T0 + group * 90 + child * 20,
        durationMs: 15 + child * 8,
        statusCode: "ok",
      });
    }
  }
  return spans;
}

export const LightAndDark: Story = {
  render: () => (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={`${theme} rounded-xl border bg-surface p-4 text-foreground`}
        >
          <p className="mb-3 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <TraceWaterfall spans={checkoutTrace} heightClassName="h-[18rem]" />
        </div>
      ))}
    </div>
  ),
};
