import { readdir } from "node:fs/promises";
import path from "node:path";
import { OUT_DIR } from "../config.ts";

/**
 * Convert every captured PNG in the output dir to a sibling WEBP.
 *
 * The marketing site references `.webp` (smaller, web-optimized) while the
 * README uses `.png`, so the pipeline emits both: Playwright writes PNGs, then
 * `cwebp` produces the WEBP variants. If `cwebp` is unavailable the PNGs still
 * stand on their own, so a missing binary warns rather than fails the run.
 */
export async function convertPngsToWebp(): Promise<{ converted: number }> {
  const files = await readdir(OUT_DIR);
  const pngs = files.filter((f) => f.endsWith(".png"));
  let converted = 0;
  for (const png of pngs) {
    const input = path.join(OUT_DIR, png);
    const output = path.join(OUT_DIR, png.replace(/\.png$/, ".webp"));
    const proc = Bun.spawn({
      cmd: ["cwebp", "-quiet", "-q", "82", input, "-o", output],
      stdio: ["ignore", "ignore", "pipe"],
    });
    const code = await proc.exited;
    if (code === 0) {
      converted++;
    } else if (converted === 0 && png === pngs[0]) {
      // First conversion failed - almost certainly cwebp is missing. Warn once
      // and stop trying; the PNGs remain the usable output.
      console.warn(
        "  cwebp not available - skipping WEBP output (PNGs are still written)",
      );
      break;
    }
  }
  return { converted };
}
