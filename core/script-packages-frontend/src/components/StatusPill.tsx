import React from "react";
import { StatusPill as SharedStatusPill } from "@checkstack/ui";
import type { StatusTone } from "../pages/status-display";

/**
 * Thin adapter over the shared pill in `@checkstack/ui`, keeping this package's
 * `label` prop so its call sites read unchanged.
 */
export const StatusPill: React.FC<{ tone: StatusTone; label: string }> = ({
  tone,
  label,
}) => <SharedStatusPill tone={tone}>{label}</SharedStatusPill>;
