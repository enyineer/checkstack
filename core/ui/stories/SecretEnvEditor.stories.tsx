import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SecretEnvEditor } from "../src/components/DynamicForm/SecretEnvEditor";
import { Label } from "../src/components/Label";

const meta: Meta<typeof SecretEnvEditor> = {
  title: "Components/Inputs/SecretEnvEditor",
  component: SecretEnvEditor,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SecretEnvEditor>;

const Demo = ({
  initial,
  secretNames,
}: {
  initial?: Record<string, string>;
  secretNames?: string[];
}) => {
  const [value, setValue] = useState<Record<string, string>>(initial ?? {});
  return (
    <div className="max-w-xl space-y-2">
      <Label>Secret environment variables</Label>
      <SecretEnvEditor
        id="demo-secret-env"
        value={value}
        onChange={setValue}
        secretNames={secretNames}
      />
      <pre className="text-xs text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
};

/** Empty editor with secret-name suggestions available. */
export const Empty: Story = {
  render: () => (
    <Demo secretNames={["jira_token", "db_password", "smtp_api_key"]} />
  ),
};

/** Pre-populated mapping; the stored value is the `${{ secrets.NAME }}` template. */
export const WithValues: Story = {
  render: () => (
    <Demo
      initial={{
        API_TOKEN: "${{ secrets.jira_token }}",
        DB_PASSWORD: "${{ secrets.db_password }}",
      }}
      secretNames={["jira_token", "db_password", "smtp_api_key"]}
    />
  ),
};

/** No name suggestions available — the secret field is plain free text. */
export const NoSuggestions: Story = {
  render: () => <Demo initial={{ TOKEN: "${{ secrets.some_secret }}" }} />,
};
