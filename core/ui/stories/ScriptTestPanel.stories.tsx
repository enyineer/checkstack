import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
  ScriptTestPanel,
  ContextSampleEditor,
  type ScriptTestPanelResult,
} from "../src/components/ScriptTestPanel";

const meta: Meta<typeof ScriptTestPanel> = {
  title: "Components/Editors/ScriptTestPanel",
  component: ScriptTestPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ScriptTestPanel>;

function delay<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const successResult: ScriptTestPanelResult = {
  result: { id: "INC-42", ok: true },
  stdout: "Resolved incident INC-42\nDone.",
  stderr: "",
  durationMs: 128,
  timedOut: false,
};

const shellSuccessResult: ScriptTestPanelResult = {
  stdout: "INC-42",
  stderr: "",
  exitCode: 0,
  durationMs: 42,
  timedOut: false,
};

const failureResult: ScriptTestPanelResult = {
  stdout: "",
  stderr: "TypeError: Cannot read properties of undefined (reading 'id')",
  durationMs: 31,
  timedOut: false,
  error: "Cannot read properties of undefined (reading 'id')",
};

export const CollapsedByDefault: Story = {
  render: () => (
    <div className="max-w-xl">
      <ScriptTestPanel onRun={() => delay(successResult)} />
    </div>
  ),
};

export const TypeScriptSuccess: Story = {
  render: () => (
    <div className="max-w-xl">
      <ScriptTestPanel onRun={() => delay(successResult)} defaultOpen />
    </div>
  ),
};

export const ShellSuccess: Story = {
  render: () => (
    <div className="max-w-xl">
      <ScriptTestPanel onRun={() => delay(shellSuccessResult)} defaultOpen />
    </div>
  ),
};

export const Failure: Story = {
  render: () => (
    <div className="max-w-xl">
      <ScriptTestPanel onRun={() => delay(failureResult)} defaultOpen />
    </div>
  ),
};

export const WithSampleContextEditor: Story = {
  render: () => {
    const Wrapper: React.FC = () => {
      const [context, setContext] = React.useState(
        '{\n  "trigger": {\n    "event": "incident.created",\n    "payload": { "id": "INC-42" }\n  }\n}',
      );
      return (
        <div className="max-w-xl">
          <ScriptTestPanel
            onRun={() => delay(successResult)}
            defaultOpen
            contextEditor={
              <ContextSampleEditor value={context} onChange={setContext} />
            }
          />
        </div>
      );
    };
    return <Wrapper />;
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="max-w-xl">
      <ScriptTestPanel onRun={() => delay(successResult)} defaultOpen disabled />
    </div>
  ),
};
