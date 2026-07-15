/**
 * Read a Response body as text under a hard byte cap (streamed). Shared by the
 * metricstream core scrape source type and the satellite-side pull executor so
 * both apply the IDENTICAL response-size ceiling to a scraped endpoint. Pure
 * transport helper, no IO of its own beyond draining the passed body.
 *
 * The cap is enforced in TWO places: the declared `content-length` header (a
 * body that ANNOUNCES it is over cap is rejected before a single byte is read)
 * and the streamed length (a body that lies about / omits its length is rejected
 * mid-stream, cancelling the reader). The caller supplies `makeError` so the
 * thrown failure is the caller's OWN transport-failure type - metricstream core
 * throws a plain `Error`, the satellite throws its `ScrapeError` - both of which
 * their run executors read as "the probe could not complete".
 */
export async function readCappedText({
  response,
  maxBytes,
  makeError = (message) => new Error(message),
}: {
  response: Response;
  maxBytes: number;
  makeError?: (message: string) => Error;
}): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw makeError(`response ${declared} bytes exceeds cap ${maxBytes}`);
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw makeError(`response body exceeds cap ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
