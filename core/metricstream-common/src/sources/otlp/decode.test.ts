import { describe, it, expect } from "bun:test";
import { ProtoWriter } from "@checkstack/otlp-wire";
import {
  AGGREGATION_TEMPORALITY,
  decodeExportMetricsServiceRequest,
} from "./decode";

/** The IEEE-754 bits of a double, as a bigint (for a fixed64 field). */
function doubleBits(n: number): bigint {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, n, true);
  return new DataView(buf).getBigUint64(0, true);
}

/** Encode an AnyValue { string_value = s }. */
function anyString(s: string): Uint8Array {
  return new ProtoWriter().string(1, s).finish();
}

/** Encode a KeyValue { key, value: AnyValue{string} }. */
function keyValue(key: string, value: string): Uint8Array {
  return new ProtoWriter()
    .string(1, key)
    .bytes(2, anyString(value))
    .finish();
}

describe("decodeExportMetricsServiceRequest", () => {
  it("decodes gauge (as_double + as_int), sum (monotonic+cumulative) and histogram", () => {
    // NumberDataPoint for the gauge: attributes{host=a}, time, as_double=1.5.
    const gaugePoint = new ProtoWriter()
      .bytes(7, keyValue("host", "a"))
      .fixed64(3, 1_700_000_000_000_000_000n) // time_unix_nano
      .fixed64(4, doubleBits(1.5)) // as_double
      .finish();
    const gauge = new ProtoWriter().bytes(1, gaugePoint).finish();
    const gaugeMetric = new ProtoWriter()
      .string(1, "cpu")
      .string(3, "1")
      .bytes(5, gauge)
      .finish();

    // Sum: one int point (as_int=42), cumulative + monotonic.
    const sumPoint = new ProtoWriter().fixed64(6, 42n).finish();
    const sum = new ProtoWriter()
      .bytes(1, sumPoint)
      .uint(2, AGGREGATION_TEMPORALITY.CUMULATIVE)
      .uint(3, 1)
      .finish();
    const sumMetric = new ProtoWriter().string(1, "reqs").bytes(7, sum).finish();

    // Histogram: count=10, sum=50.0, delta temporality.
    const histoPoint = new ProtoWriter()
      .fixed64(4, 10n) // count
      .fixed64(5, doubleBits(50)) // sum
      .finish();
    const histo = new ProtoWriter()
      .bytes(1, histoPoint)
      .uint(2, AGGREGATION_TEMPORALITY.DELTA)
      .finish();
    const histoMetric = new ProtoWriter().string(1, "lat").bytes(9, histo).finish();

    const scopeMetrics = new ProtoWriter()
      .bytes(2, gaugeMetric)
      .bytes(2, sumMetric)
      .bytes(2, histoMetric)
      .finish();
    const resource = new ProtoWriter().bytes(1, keyValue("service.name", "api")).finish();
    const resourceMetrics = new ProtoWriter()
      .bytes(1, resource)
      .bytes(2, scopeMetrics)
      .finish();
    const request = new ProtoWriter().bytes(1, resourceMetrics).finish();

    const payload = decodeExportMetricsServiceRequest(request);
    expect(payload).toHaveLength(1);
    const rm = payload[0];
    expect(rm.resource["service.name"]).toBe("api");
    expect(rm.metrics).toHaveLength(3);

    const [cpu, reqs, lat] = rm.metrics;
    expect(cpu.name).toBe("cpu");
    expect(cpu.unit).toBe("1");
    expect(cpu.data).toEqual({
      kind: "gauge",
      points: [
        {
          attributes: { host: "a" },
          timeUnixNano: 1_700_000_000_000_000_000n,
          value: 1.5,
          exemplars: [],
        },
      ],
    });

    expect(reqs.data?.kind).toBe("sum");
    if (reqs.data?.kind === "sum") {
      expect(reqs.data.monotonic).toBe(true);
      expect(reqs.data.temporality).toBe(AGGREGATION_TEMPORALITY.CUMULATIVE);
      expect(reqs.data.points[0].value).toBe(42);
    }

    expect(lat.data?.kind).toBe("histogram");
    if (lat.data?.kind === "histogram") {
      expect(lat.data.temporality).toBe(AGGREGATION_TEMPORALITY.DELTA);
      expect(lat.data.points[0].count).toBe(10);
      expect(lat.data.points[0].sum).toBe(50);
    }
  });

  it("decodes exemplars on a NumberDataPoint (trace/span id bytes -> hex)", () => {
    const traceIdBytes = Uint8Array.from(
      Array.from({ length: 16 }, (_, i) => i + 1),
    ); // 0102...10
    const spanIdBytes = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0, 0, 0, 1]);
    const exemplar = new ProtoWriter()
      .fixed64(2, 1_700_000_000_500_000_000n) // time_unix_nano
      .fixed64(3, doubleBits(3.14)) // as_double
      .bytes(4, spanIdBytes) // span_id
      .bytes(5, traceIdBytes) // trace_id
      .finish();
    const gaugePoint = new ProtoWriter()
      .fixed64(4, doubleBits(1)) // as_double
      .bytes(5, exemplar) // exemplars (field 5 on NumberDataPoint)
      .finish();
    const gauge = new ProtoWriter().bytes(1, gaugePoint).finish();
    const metric = new ProtoWriter().string(1, "g").bytes(5, gauge).finish();
    const scope = new ProtoWriter().bytes(2, metric).finish();
    const rm = new ProtoWriter().bytes(2, scope).finish();
    const request = new ProtoWriter().bytes(1, rm).finish();

    const payload = decodeExportMetricsServiceRequest(request);
    const data = payload[0].metrics[0].data;
    expect(data?.kind).toBe("gauge");
    if (data?.kind === "gauge") {
      const [ex] = data.points[0].exemplars ?? [];
      expect(ex.traceId).toBe("0102030405060708090a0b0c0d0e0f10");
      expect(ex.spanId).toBe("aabbccdd00000001");
      expect(ex.value).toBe(3.14);
      expect(ex.timeUnixNano).toBe(1_700_000_000_500_000_000n);
    }
  });

  it("decodes exemplars on a HistogramDataPoint (field 8)", () => {
    const traceIdBytes = new Uint8Array(16).fill(0xab);
    const exemplar = new ProtoWriter()
      .fixed64(6, 7n) // as_int
      .bytes(5, traceIdBytes) // trace_id
      .finish();
    const histoPoint = new ProtoWriter()
      .fixed64(4, 5n) // count
      .bytes(8, exemplar) // exemplars (field 8 on HistogramDataPoint)
      .finish();
    const histo = new ProtoWriter()
      .bytes(1, histoPoint)
      .uint(2, AGGREGATION_TEMPORALITY.CUMULATIVE)
      .finish();
    const metric = new ProtoWriter().string(1, "h").bytes(9, histo).finish();
    const scope = new ProtoWriter().bytes(2, metric).finish();
    const rm = new ProtoWriter().bytes(2, scope).finish();
    const request = new ProtoWriter().bytes(1, rm).finish();

    const data = decodeExportMetricsServiceRequest(request)[0].metrics[0].data;
    expect(data?.kind).toBe("histogram");
    if (data?.kind === "histogram") {
      const [ex] = data.points[0].exemplars ?? [];
      expect(ex.traceId).toBe("ab".repeat(16));
      expect(ex.value).toBe(7);
      expect(ex.spanId).toBe(""); // absent span_id stays empty
    }
  });

  it("skips unknown fields (a newer producer decodes fine)", () => {
    const gaugePoint = new ProtoWriter().fixed64(4, doubleBits(2)).finish();
    const gauge = new ProtoWriter().bytes(1, gaugePoint).finish();
    const metric = new ProtoWriter()
      .string(1, "g")
      .string(2, "a description") // field 2 (description) - not decoded, must skip
      .bytes(5, gauge)
      .finish();
    const scope = new ProtoWriter().bytes(2, metric).finish();
    const rm = new ProtoWriter().bytes(2, scope).finish();
    const request = new ProtoWriter().bytes(1, rm).finish();

    const payload = decodeExportMetricsServiceRequest(request);
    expect(payload[0].metrics[0].name).toBe("g");
    expect(payload[0].metrics[0].data?.kind).toBe("gauge");
  });
});
