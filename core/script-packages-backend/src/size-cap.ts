import type { SizeCapConfig } from "@checkstack/script-packages-common";

export type SizeCapVerdict =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "block"; message: string };

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Evaluate a resolved total size against the configured cap. `block` should
 * refuse the install; `warn` surfaces a non-fatal notice in the admin UI.
 */
export function evaluateSizeCap({
  totalSizeBytes,
  cap,
}: {
  totalSizeBytes: number;
  cap: SizeCapConfig;
}): SizeCapVerdict {
  if (totalSizeBytes > cap.blockBytes) {
    return {
      level: "block",
      message: `Resolved package size ${mb(totalSizeBytes)} exceeds the ${mb(
        cap.blockBytes,
      )} block threshold. Remove packages or raise the cap.`,
    };
  }
  if (totalSizeBytes > cap.warnBytes) {
    return {
      level: "warn",
      message: `Resolved package size ${mb(totalSizeBytes)} exceeds the ${mb(
        cap.warnBytes,
      )} warning threshold.`,
    };
  }
  return { level: "ok" };
}
