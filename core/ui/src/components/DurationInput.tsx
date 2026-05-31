import React from "react";
import { Input } from "./Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

/**
 * The duration units this input edits. Mirrors the single-unit object
 * form the automation `Duration` schema accepts
 * (`{ seconds } | { minutes } | { hours }`).
 */
export type DurationUnit = "seconds" | "minutes" | "hours";

/**
 * A single-unit duration value: `{ seconds: 30 }`, `{ minutes: 5 }`, etc.
 * This is exactly the object form the backend `Duration` schema accepts,
 * so a `DurationInput` round-trips losslessly to/from the stored value.
 */
export type DurationValue = Partial<Record<DurationUnit, number>>;

export interface DurationInputProps {
  /** Current duration, or undefined when unset. */
  value: DurationValue | undefined;
  onChange: (next: DurationValue | undefined) => void;
  /** Default unit when the operator first types a value. Defaults to "minutes". */
  defaultUnit?: DurationUnit;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const UNIT_LABELS: Record<DurationUnit, string> = {
  seconds: "seconds",
  minutes: "minutes",
  hours: "hours",
};

/** Read the (unit, amount) pair out of a single-unit duration value. */
function decompose(
  value: DurationValue | undefined,
  fallbackUnit: DurationUnit,
): { unit: DurationUnit; amount: number | undefined } {
  if (value) {
    for (const unit of ["seconds", "minutes", "hours"] as const) {
      const amount = value[unit];
      if (amount !== undefined) return { unit, amount };
    }
  }
  return { unit: fallbackUnit, amount: undefined };
}

/**
 * Number + unit picker for a single-unit duration (`for:` dwells,
 * threshold windows, poll intervals). Emits the object form the backend
 * `Duration` schema accepts, so it round-trips losslessly through YAML.
 *
 * No animations or heavy effects, so no `usePerformance` gating is needed
 * - it is a plain numeric input plus a unit `Select`.
 */
export const DurationInput: React.FC<DurationInputProps> = ({
  value,
  onChange,
  defaultUnit = "minutes",
  disabled,
  id,
  className,
}) => {
  const { unit, amount } = decompose(value, defaultUnit);

  const emit = (nextUnit: DurationUnit, nextAmount: number | undefined) => {
    const cleared: DurationValue | undefined = undefined;
    if (nextAmount === undefined || !Number.isFinite(nextAmount)) {
      onChange(cleared);
      return;
    }
    onChange({ [nextUnit]: Math.max(0, Math.floor(nextAmount)) });
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Input
        id={id}
        type="number"
        min={1}
        inputMode="numeric"
        className="w-24"
        value={amount ?? ""}
        disabled={disabled}
        placeholder="0"
        onChange={(event) =>
          emit(
            unit,
            event.target.value === ""
              ? undefined
              : Number(event.target.value),
          )
        }
      />
      <Select
        value={unit}
        disabled={disabled}
        onValueChange={(nextUnit) => emit(nextUnit as DurationUnit, amount)}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["seconds", "minutes", "hours"] as const).map((u) => (
            <SelectItem key={u} value={u}>
              {UNIT_LABELS[u]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
