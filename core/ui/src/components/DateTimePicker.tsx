import React, { useState, useEffect, useCallback } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { Button } from "./Button";
import { Calendar, Clock } from "lucide-react";
import "react-day-picker/style.css";

export interface DateTimePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
}

interface FieldState {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

const padZero = (value: number, length: number = 2): string =>
  String(value).padStart(length, "0");

// Only allow numeric characters
const filterNumeric = (value: string): string => {
  return value.replaceAll(/[^0-9]/g, "");
};

/**
 * Combined date and time picker component with independent fields and calendar popup
 */
export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  minDate,
  maxDate,
  className,
}) => {
  const isValidDate = value instanceof Date && !Number.isNaN(value.getTime());

  // Track if the change came from internal editing
  const isInternalChange = React.useRef(false);

  // Initialize state from value
  const [fields, setFields] = useState<FieldState>(() => ({
    day: isValidDate ? padZero(value.getDate()) : "",
    month: isValidDate ? padZero(value.getMonth() + 1) : "",
    year: isValidDate ? String(value.getFullYear()) : "",
    hour: isValidDate ? padZero(value.getHours()) : "",
    minute: isValidDate ? padZero(value.getMinutes()) : "",
  }));

  const [calendarOpen, setCalendarOpen] = useState(false);

  // Sync state when value prop changes from outside (not from internal editing)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (isValidDate) {
      setFields({
        day: padZero(value.getDate()),
        month: padZero(value.getMonth() + 1),
        year: String(value.getFullYear()),
        hour: padZero(value.getHours()),
        minute: padZero(value.getMinutes()),
      });
    }
  }, [value, isValidDate]);

  // Build date from fields or return undefined if any field is invalid
  const buildDate = useCallback((f: FieldState): Date | undefined => {
    const day = Number.parseInt(f.day, 10);
    const month = Number.parseInt(f.month, 10);
    const year = Number.parseInt(f.year, 10);
    const hour = Number.parseInt(f.hour, 10);
    const minute = Number.parseInt(f.minute, 10);

    if (
      Number.isNaN(day) ||
      Number.isNaN(month) ||
      Number.isNaN(year) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute)
    ) {
      return undefined;
    }

    // Validate ranges
    if (
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12 ||
      year < 1 ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return undefined;
    }

    // Create date and check if it's valid (handles Feb 30, etc.)
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    // If the date rolled over to the next month, it was invalid
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
      return undefined;
    }

    return date;
  }, []);

  const handleFieldChange = (field: keyof FieldState, inputValue: string) => {
    const filtered = filterNumeric(inputValue);
    const newFields = { ...fields, [field]: filtered };
    setFields(newFields);
    isInternalChange.current = true;
    onChange(buildDate(newFields));
  };

  // Helper to get days in a month (respects leap years)
  const getDaysInMonth = (month: number, year: number): number => {
    // Use Date to calculate (day 0 of next month = last day of current month)
    return new Date(year, month, 0).getDate();
  };

  // Validate and clamp value on blur
  const handleFieldBlur = (field: keyof FieldState) => {
    const value = Number.parseInt(fields[field], 10);
    if (Number.isNaN(value)) return;

    let clamped: number;
    let formatted: string;

    switch (field) {
      case "day": {
        const month = Number.parseInt(fields.month, 10);
        const year = Number.parseInt(fields.year, 10);
        // Use 31 as fallback if month/year aren't valid yet
        const maxDay =
          !Number.isNaN(month) && !Number.isNaN(year)
            ? getDaysInMonth(month, year)
            : 31;
        clamped = Math.min(Math.max(value, 1), maxDay);
        formatted = padZero(clamped);
        break;
      }
      case "month": {
        clamped = Math.min(Math.max(value, 1), 12);
        formatted = padZero(clamped);
        // Also re-clamp day if month changes and day is now out of range
        {
          const day = Number.parseInt(fields.day, 10);
          const year = Number.parseInt(fields.year, 10);
          if (!Number.isNaN(day) && !Number.isNaN(year)) {
            const maxDay = getDaysInMonth(clamped, year);
            if (day > maxDay) {
              const newFields = {
                ...fields,
                month: padZero(clamped),
                day: padZero(maxDay),
              };
              setFields(newFields);
              isInternalChange.current = true;
              onChange(buildDate(newFields));
              return;
            }
          }
        }
        break;
      }
      case "year": {
        clamped = Math.max(value, 1);
        formatted = String(clamped);
        // Also re-clamp day if year changes (for leap year Feb 29 -> 28)
        {
          const day = Number.parseInt(fields.day, 10);
          const month = Number.parseInt(fields.month, 10);
          if (!Number.isNaN(day) && !Number.isNaN(month)) {
            const maxDay = getDaysInMonth(month, clamped);
            if (day > maxDay) {
              const newFields = {
                ...fields,
                year: String(clamped),
                day: padZero(maxDay),
              };
              setFields(newFields);
              isInternalChange.current = true;
              onChange(buildDate(newFields));
              return;
            }
          }
        }
        break;
      }
      case "hour": {
        clamped = Math.min(Math.max(value, 0), 23);
        formatted = padZero(clamped);
        break;
      }
      case "minute": {
        clamped = Math.min(Math.max(value, 0), 59);
        formatted = padZero(clamped);
        break;
      }
      default: {
        return;
      }
    }

    if (fields[field] !== formatted) {
      const newFields = { ...fields, [field]: formatted };
      setFields(newFields);
      isInternalChange.current = true;
      onChange(buildDate(newFields));
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (date) {
      const newFields = {
        ...fields,
        day: padZero(date.getDate()),
        month: padZero(date.getMonth() + 1),
        year: String(date.getFullYear()),
      };
      setFields(newFields);
      onChange(buildDate(newFields));
      setCalendarOpen(false);
    }
  };

  // Get selected date for calendar (only if date fields are valid)
  const getSelectedDate = (): Date | undefined => {
    const day = Number.parseInt(fields.day, 10);
    const month = Number.parseInt(fields.month, 10);
    const year = Number.parseInt(fields.year, 10);
    if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
      return undefined;
    }
    return new Date(year, month - 1, day);
  };

  return (
    <div className={`flex items-center ${className ?? ""}`}>
      {/* Combined date and time container */}
      <div className="flex items-center border rounded-lg bg-background overflow-hidden">
        {/* Date section with calendar popup */}
        <Popover.Root open={calendarOpen} onOpenChange={setCalendarOpen}>
          <Popover.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none border-r"
              type="button"
            >
              <Calendar className="h-4 w-4" />
            </Button>
          </Popover.Trigger>

          <div className="flex items-center px-2">
            <input
              type="text"
              inputMode="numeric"
              value={fields.day}
              onChange={(e) => handleFieldChange("day", e.target.value)}
              onBlur={() => handleFieldBlur("day")}
              placeholder="DD"
              className="w-7 text-center bg-transparent border-none outline-none text-sm font-mono"
              maxLength={2}
            />
            <span className="text-muted-foreground">/</span>
            <input
              type="text"
              inputMode="numeric"
              value={fields.month}
              onChange={(e) => handleFieldChange("month", e.target.value)}
              onBlur={() => handleFieldBlur("month")}
              placeholder="MM"
              className="w-7 text-center bg-transparent border-none outline-none text-sm font-mono"
              maxLength={2}
            />
            <span className="text-muted-foreground">/</span>
            <input
              type="text"
              inputMode="numeric"
              value={fields.year}
              onChange={(e) => handleFieldChange("year", e.target.value)}
              onBlur={() => handleFieldBlur("year")}
              placeholder="YYYY"
              className="w-11 text-center bg-transparent border-none outline-none text-sm font-mono"
              maxLength={4}
            />
          </div>

          <Popover.Portal>
            <Popover.Content
              className="z-50 rounded-md border bg-popover p-3 shadow-md"
              sideOffset={5}
              align="start"
            >
              <DayPicker
                mode="single"
                selected={getSelectedDate()}
                onSelect={handleCalendarSelect}
                fromDate={minDate}
                toDate={maxDate}
                classNames={{
                  root: "rdp-root",
                  day: "rdp-day hover:bg-accent rounded-md",
                  selected: "bg-primary text-primary-foreground",
                  today: "font-bold text-primary",
                  chevron: "fill-foreground",
                  button_previous: "hover:bg-accent rounded-md p-1",
                  button_next: "hover:bg-accent rounded-md p-1",
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Separator */}
        <div className="w-px h-6 bg-border" />

        {/* Time section */}
        <div className="flex items-center px-2">
          <Clock className="h-4 w-4 text-muted-foreground mr-2" />
          <input
            type="text"
            inputMode="numeric"
            value={fields.hour}
            onChange={(e) => handleFieldChange("hour", e.target.value)}
            onBlur={() => handleFieldBlur("hour")}
            placeholder="HH"
            className="w-6 text-center bg-transparent border-none outline-none text-sm font-mono"
            maxLength={2}
          />
          <span className="text-muted-foreground">:</span>
          <input
            type="text"
            inputMode="numeric"
            value={fields.minute}
            onChange={(e) => handleFieldChange("minute", e.target.value)}
            onBlur={() => handleFieldBlur("minute")}
            placeholder="MM"
            className="w-6 text-center bg-transparent border-none outline-none text-sm font-mono"
            maxLength={2}
          />
        </div>
      </div>
    </div>
  );
};
