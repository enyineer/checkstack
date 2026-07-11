import React from "react";
import { Button, Input, Label } from "@checkstack/ui";
import { Plus, Trash2 } from "lucide-react";
import { emptyRow, type CustomFieldRow } from "./environment-fields.logic";

interface CustomFieldsEditorProps {
  /** The editable rows (controlled). Owned by the parent editor's state. */
  fields: CustomFieldRow[];
  /** Called with the next rows on any add/edit/remove. */
  onChange: (next: CustomFieldRow[]) => void;
  /** Helper text under the label explaining where the fields surface. */
  description: React.ReactNode;
}

/**
 * Free-form key/value custom-fields editor, shared by the System and
 * Environment editors. Controlled: the parent owns the `fields` state so it
 * can validate (`hasDuplicateKeys`) and serialize (`rowsToMetadata`) on save.
 * The pure row<->record conversion lives in `environment-fields.logic.ts`.
 */
export const CustomFieldsEditor: React.FC<CustomFieldsEditorProps> = ({
  fields,
  onChange,
  description,
}) => {
  const updateField = (rowId: string, patch: Partial<CustomFieldRow>) => {
    onChange(
      fields.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
    );
  };

  const removeField = (rowId: string) => {
    onChange(fields.filter((row) => row.rowId !== rowId));
  };

  const addField = () => {
    onChange([...fields, emptyRow()]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Custom fields</Label>
        <Button type="button" size="sm" variant="outline" onClick={addField}>
          <Plus className="w-4 h-4 mr-1" />
          Add field
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No custom fields yet.
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((row) => (
            <div key={row.rowId} className="flex items-center gap-2">
              <Input
                aria-label="Field key"
                placeholder="key"
                value={row.key}
                onChange={(e) =>
                  updateField(row.rowId, { key: e.target.value })
                }
              />
              <Input
                aria-label="Field value"
                placeholder="value"
                value={row.value}
                onChange={(e) =>
                  updateField(row.rowId, { value: e.target.value })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeField(row.rowId)}
                aria-label="Remove field"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
