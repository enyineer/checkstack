import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";

const padZero = (value: number): string => String(value).padStart(2, "0");
const filterNumeric = (value: string): string => value.replaceAll(/[^0-9]/g, "");

export interface TimeOfDayInputProps {
  /** `"HH:mm"` (24h) or undefined when unset. */
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Split a `"HH:mm"` string into its fields, tolerating partial input. */
function split(value: string | undefined): { hour: string; minute: string } {
  if (!value) return { hour: "", minute: "" };
  const [h = "", m = ""] = value.split(":");
  return { hour: h, minute: m };
}

/**
 * 24h time-of-day (HH:MM) input. Two numeric fields mirroring the time
 * section of {@link DateTimePicker}. Emits a `"HH:mm"` string (or
 * undefined when either field is empty), the exact shape the automation
 * `time` condition's `after` / `before` accept - so it round-trips
 * losslessly through YAML.
 *
 * Plain inputs, no animations - no `usePerformance` gating needed.
 */
export const TimeOfDayInput: React.FC<TimeOfDayInputProps> = ({
  value,
  onChange,
  disabled,
  id,
  className,
}) => {
  const [fields, setFields] = useState(() => split(value));
  const isInternalChange = React.useRef(false);

  // Sync from external value changes (not our own edits).
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    setFields(split(value));
  }, [value]);

  const emit = (next: { hour: string; minute: string }) => {
    isInternalChange.current = true;
    const cleared: string | undefined = undefined;
    if (next.hour === "" || next.minute === "") {
      onChange(cleared);
      return;
    }
    onChange(`${padZero(Number(next.hour))}:${padZero(Number(next.minute))}`);
  };

  const handleChange = (field: "hour" | "minute", raw: string) => {
    const filtered = filterNumeric(raw).slice(0, 2);
    const next = { ...fields, [field]: filtered };
    setFields(next);
    emit(next);
  };

  const handleBlur = (field: "hour" | "minute") => {
    const raw = fields[field];
    if (raw === "") return;
    const n = Number(raw);
    const max = field === "hour" ? 23 : 59;
    const clamped = padZero(Math.min(Math.max(n, 0), max));
    if (clamped !== raw) {
      const next = { ...fields, [field]: clamped };
      setFields(next);
      emit(next);
    }
  };

  return (
    <div
      className={`inline-flex items-center border rounded-lg bg-background px-2 py-1 ${
        className ?? ""
      }`}
    >
      <Clock className="h-4 w-4 text-muted-foreground mr-2" />
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={fields.hour}
        onChange={(event) => handleChange("hour", event.target.value)}
        onBlur={() => handleBlur("hour")}
        placeholder="HH"
        aria-label="Hour"
        className="w-7 text-center bg-transparent border-none outline-none text-sm font-mono disabled:opacity-50"
        maxLength={2}
        disabled={disabled}
      />
      <span className="text-muted-foreground">:</span>
      <input
        type="text"
        inputMode="numeric"
        value={fields.minute}
        onChange={(event) => handleChange("minute", event.target.value)}
        onBlur={() => handleBlur("minute")}
        placeholder="MM"
        aria-label="Minute"
        className="w-7 text-center bg-transparent border-none outline-none text-sm font-mono disabled:opacity-50"
        maxLength={2}
        disabled={disabled}
      />
    </div>
  );
};
