import React, { useState, useRef, useEffect } from "react";
import { cn } from "../utils";
import { Input } from "./Input";
import { Button } from "./Button";
import { Check, X } from "lucide-react";

export interface EditableTextProps {
  value: string;
  onSave: (newValue: string) => Promise<void> | void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  validate?: (value: string) => boolean;
  disabled?: boolean;
}

export const EditableText: React.FC<EditableTextProps> = ({
  value,
  onSave,
  className,
  inputClassName,
  placeholder,
  validate,
  disabled = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleEdit = () => {
    setEditValue(value);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleSave = async () => {
    const trimmedValue = editValue.trim();

    if (!trimmedValue) {
      return;
    }

    if (validate && !validate(trimmedValue)) {
      return;
    }

    if (trimmedValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(trimmedValue);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setEditValue(e.target.value)
          }
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isSaving}
          className={cn("flex-1", inputClassName)}
        />
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 text-success hover:text-success/80 hover:bg-success/10"
          onClick={handleSave}
          disabled={isSaving || !editValue.trim()}
          type="button"
        >
          <Check className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
          onClick={handleCancel}
          disabled={isSaving}
          type="button"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "cursor-pointer hover:underline hover:decoration-dashed hover:decoration-1 hover:underline-offset-4 transition-all",
        disabled && "cursor-default hover:no-underline opacity-50",
        className
      )}
      onClick={disabled ? undefined : handleEdit}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleEdit();
        }
      }}
    >
      {value}
    </div>
  );
};
