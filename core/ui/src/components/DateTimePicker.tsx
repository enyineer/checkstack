import React from "react";
import { format } from "date-fns";
import { Input } from "./Input";
import { Calendar, Clock } from "lucide-react";

export interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
}

/**
 * Combined date and time picker component
 */
export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  minDate,
  maxDate,
  className,
}) => {
  const dateString = format(value, "yyyy-MM-dd");
  const timeString = format(value, "HH:mm");

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [year, month, day] = e.target.value.split("-").map(Number);
    const newDate = new Date(value);
    newDate.setFullYear(year, month - 1, day);
    onChange(newDate);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = e.target.value.split(":").map(Number);
    const newDate = new Date(value);
    newDate.setHours(hours, minutes);
    onChange(newDate);
  };

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <div className="relative flex-1">
        <Input
          type="date"
          value={dateString}
          onChange={handleDateChange}
          min={minDate ? format(minDate, "yyyy-MM-dd") : undefined}
          max={maxDate ? format(maxDate, "yyyy-MM-dd") : undefined}
          className="pl-9"
        />
        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      <div className="relative w-28">
        <Input
          type="time"
          value={timeString}
          onChange={handleTimeChange}
          className="pl-9"
        />
        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  );
};
