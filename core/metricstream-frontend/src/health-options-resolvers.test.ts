import { describe, it, expect } from "bun:test";
import {
  streamToOption,
  metricNameToOption,
  stringToOption,
  readSelectedStreamId,
  readCollectorMetricName,
  readRowLabelKey,
} from "./health-options-resolvers";

describe("option mappers", () => {
  it("maps a stream to value=id, label=name", () => {
    expect(streamToOption({ id: "s1", name: "Prod" })).toEqual({
      value: "s1",
      label: "Prod",
    });
  });

  it("labels a metric name with type, unit and series count", () => {
    const opt = metricNameToOption({
      name: "http_requests_total",
      type: "counter",
      counterKind: "cumulative",
      unit: "1",
      help: null,
      seriesCount: 12,
      lastSeenAt: new Date(),
    });
    expect(opt.value).toBe("http_requests_total");
    expect(opt.label).toBe("http_requests_total (counter 1, 12 series)");
  });

  it("maps a raw string to a value=label option", () => {
    expect(stringToOption("GET")).toEqual({ value: "GET", label: "GET" });
  });
});

describe("form-value readers", () => {
  it("reads the strategy stream id", () => {
    expect(readSelectedStreamId({ streamId: "s1" })).toBe("s1");
    expect(readSelectedStreamId({})).toBeUndefined();
    expect(readSelectedStreamId({ streamId: "" })).toBeUndefined();
  });

  it("reads the collector metric name", () => {
    expect(readCollectorMetricName({ metricName: "m" })).toBe("m");
    expect(readCollectorMetricName({})).toBeUndefined();
  });

  it("reads the filter ROW's own key (row-scoped formValues)", () => {
    // The DynamicForm row-scoping merges the row's fields over the whole-form
    // values, so the label-value resolver sees both `metricName` and its row's
    // `key` in one `formValues` object.
    const rowScoped = { metricName: "m", key: "method", value: "" };
    expect(readCollectorMetricName(rowScoped)).toBe("m");
    expect(readRowLabelKey(rowScoped)).toBe("method");
    expect(readRowLabelKey({ metricName: "m" })).toBeUndefined();
  });
});
