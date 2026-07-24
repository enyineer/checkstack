import { describe, it, expect } from "bun:test";
import {
  effectiveEventTimestamp,
  eventSeverity,
  eventToLogRecord,
  K8S_EVENT_SEVERITY_INFO,
  K8S_EVENT_SEVERITY_WARN,
} from "./mapper";
import { K8sEventSchema } from "./k8s-event";

const parse = (raw: unknown) => {
  const result = K8sEventSchema.safeParse(raw);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
};

describe("effectiveEventTimestamp", () => {
  it("prefers series.lastObservedTime over eventTime for a repeating series", () => {
    const event = parse({
      eventTime: "2026-07-14T10:00:00.000000Z",
      series: { count: 5, lastObservedTime: "2026-07-14T10:09:30.000000Z" },
    });
    expect(effectiveEventTimestamp(event)?.toISOString()).toBe(
      "2026-07-14T10:09:30.000Z",
    );
  });

  it("falls back eventTime -> deprecatedLastTimestamp -> creationTimestamp", () => {
    expect(
      effectiveEventTimestamp(
        parse({ eventTime: "2026-07-14T10:00:00Z" }),
      )?.toISOString(),
    ).toBe("2026-07-14T10:00:00.000Z");
    expect(
      effectiveEventTimestamp(
        parse({ deprecatedLastTimestamp: "2026-07-14T09:00:00Z" }),
      )?.toISOString(),
    ).toBe("2026-07-14T09:00:00.000Z");
    expect(
      effectiveEventTimestamp(
        parse({ metadata: { creationTimestamp: "2026-07-14T08:00:00Z" } }),
      )?.toISOString(),
    ).toBe("2026-07-14T08:00:00.000Z");
  });

  it("returns null when no timestamp is present or parseable", () => {
    expect(effectiveEventTimestamp(parse({ reason: "X" }))).toBeNull();
    expect(
      effectiveEventTimestamp(parse({ eventTime: "not-a-date" })),
    ).toBeNull();
  });

  it("ignores a null series and null deprecated timestamps", () => {
    const event = parse({
      series: null,
      deprecatedLastTimestamp: null,
      eventTime: "2026-07-14T10:00:00Z",
    });
    expect(effectiveEventTimestamp(event)?.toISOString()).toBe(
      "2026-07-14T10:00:00.000Z",
    );
  });
});

describe("eventSeverity", () => {
  it("maps Warning to WARN and Normal/other to INFO", () => {
    expect(eventSeverity("Warning")).toEqual({
      severityNumber: K8S_EVENT_SEVERITY_WARN,
      severityText: "Warning",
    });
    expect(eventSeverity("Normal")).toEqual({
      severityNumber: K8S_EVENT_SEVERITY_INFO,
      severityText: "Normal",
    });
    expect(eventSeverity(undefined)).toEqual({
      severityNumber: K8S_EVENT_SEVERITY_INFO,
      severityText: "Normal",
    });
  });
});

describe("eventToLogRecord", () => {
  it("builds body from reason + note and carries identity attributes", () => {
    const record = eventToLogRecord(
      parse({
        metadata: { name: "pod.17abc", uid: "uid-123", namespace: "meta-ns" },
        eventTime: "2026-07-14T10:00:00Z",
        type: "Warning",
        reason: "BackOff",
        note: "Back-off restarting failed container",
        action: "Restarting",
        reportingController: "kubelet",
        reportingInstance: "node-1",
        series: { count: 7 },
        regarding: {
          kind: "Pod",
          name: "web-0",
          namespace: "prod",
          uid: "obj-9",
          apiVersion: "v1",
        },
      }),
    );
    expect(record).not.toBeNull();
    expect(record?.body).toBe("BackOff: Back-off restarting failed container");
    expect(record?.severityNumber).toBe(K8S_EVENT_SEVERITY_WARN);
    expect(record?.severityText).toBe("Warning");
    expect(record?.ts.toISOString()).toBe("2026-07-14T10:00:00.000Z");
    expect(record?.resource).toBeUndefined();
    expect(record?.attributes).toEqual({
      "k8s.namespace.name": "prod",
      "k8s.event.reason": "BackOff",
      "k8s.event.action": "Restarting",
      "k8s.event.type": "Warning",
      "k8s.event.reporting_controller": "kubelet",
      "k8s.event.reporting_instance": "node-1",
      "k8s.event.uid": "uid-123",
      "k8s.event.name": "pod.17abc",
      "k8s.event.series_count": 7,
      "k8s.object.kind": "Pod",
      "k8s.object.name": "web-0",
      "k8s.object.uid": "obj-9",
      "k8s.object.api_version": "v1",
    });
  });

  it("falls back to the object namespace when regarding has none", () => {
    const record = eventToLogRecord(
      parse({
        metadata: { namespace: "meta-ns" },
        eventTime: "2026-07-14T10:00:00Z",
        reason: "Created",
      }),
    );
    expect(record?.attributes?.["k8s.namespace.name"]).toBe("meta-ns");
    expect(record?.body).toBe("Created");
  });

  it("returns null for an event with no usable timestamp (caller skips it)", () => {
    expect(eventToLogRecord(parse({ reason: "X", note: "y" }))).toBeNull();
  });
});
