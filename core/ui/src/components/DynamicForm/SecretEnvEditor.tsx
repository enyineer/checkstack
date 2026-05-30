import React from "react";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { Button } from "../Button";
import { Input } from "../Input";
import {
  objectToRows,
  rowsToObject,
  type SecretEnvRow,
} from "./secretEnv.logic";

/**
 * Editor for a secret -> env mapping (`{ ENV_NAME: "${{ secrets.NAME }}" }`).
 *
 * Each row is an env-var name (free text) plus the referenced secret name.
 * When `secretNames` is supplied (from the secrets plugin's
 * `listSecretNames`) the secret field offers a `<datalist>` of available
 * names; a name not in the list (e.g. one not created yet) still
 * round-trips. The stored value is always the canonical
 * `${{ secrets.NAME }}` template.
 *
 * No animations or blurs, so it degrades fine on low-power devices.
 */
export interface SecretEnvEditorProps {
  /** Unique id prefix for inputs. */
  id: string;
  /** Current mapping `{ ENV_NAME: "${{ secrets.NAME }}" }`. */
  value: Record<string, string>;
  /** Callback when the mapping changes. */
  onChange: (next: Record<string, string>) => void;
  /** Available secret names for the value picker (names only, never values). */
  secretNames?: string[];
}

export const SecretEnvEditor: React.FC<SecretEnvEditorProps> = ({
  id,
  value,
  onChange,
  secretNames,
}) => {
  // Internal row state allows incomplete rows while editing; serialization
  // to the parent drops them (mirrors KeyValueEditor).
  const [rows, setRows] = React.useState<SecretEnvRow[]>(() => objectToRows(value));
  const isInternalChangeRef = React.useRef(false);

  React.useEffect(() => {
    if (isInternalChangeRef.current) {
      isInternalChangeRef.current = false;
      return;
    }
    if (Object.keys(value).length > 0) {
      setRows(objectToRows(value));
    }
  }, [value]);

  const notify = (next: SecretEnvRow[]) => {
    isInternalChangeRef.current = true;
    setRows(next);
    onChange(rowsToObject(next));
  };

  const listId = `${id}-secret-names`;

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No secrets mapped. Add an environment variable backed by a secret.
        </p>
      )}

      {secretNames && secretNames.length > 0 && (
        <datalist id={listId}>
          {secretNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}

      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            id={`${id}-env-${index}`}
            value={row.envName}
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...next[index], envName: e.target.value };
              notify(next);
            }}
            placeholder="ENV_NAME"
            className="flex-1 font-mono text-sm"
          />
          <span className="text-muted-foreground">=</span>
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${id}-secret-${index}`}
              value={row.secretName}
              list={secretNames && secretNames.length > 0 ? listId : undefined}
              onChange={(e) => {
                const next = [...rows];
                next[index] = { ...next[index], secretName: e.target.value };
                notify(next);
              }}
              placeholder="secret name"
              className="pl-8 font-mono text-sm"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              const next = [...rows];
              next.splice(index, 1);
              notify(next);
            }}
            className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive/90"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => notify([...rows, { envName: "", secretName: "" }])}
        className="h-8 gap-1"
      >
        <Plus className="h-4 w-4" />
        Add secret
      </Button>
    </div>
  );
};
