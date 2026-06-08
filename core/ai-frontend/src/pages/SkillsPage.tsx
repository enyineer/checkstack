import React from "react";
import { Lightbulb, Plus, Pencil, Trash2, X } from "lucide-react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AiApi,
  aiAccess,
  type AiSkill,
  type AiSkillTarget,
  type CreateSkillInput,
} from "@checkstack/ai-common";
import {
  PageLayout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Label,
  Textarea,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  LoadingSpinner,
  QueryErrorState,
  EmptyState,
  ConfirmationModal,
  useToast,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";

const TARGETS: { value: AiSkillTarget; label: string }[] = [
  { value: "chat", label: "Chat assistant" },
  { value: "ai_analyze", label: "AI Analyze action" },
];

interface SkillFormState {
  name: string;
  description: string;
  targets: AiSkillTarget[];
  systemPrompt: string;
  promptTemplate: string;
}

const EMPTY_FORM: SkillFormState = {
  name: "",
  description: "",
  targets: ["chat"],
  systemPrompt: "",
  promptTemplate: "",
};

function toInput(form: SkillFormState): CreateSkillInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    targets: form.targets,
    systemPrompt: form.systemPrompt.trim() || undefined,
    promptTemplate: form.promptTemplate.trim() || undefined,
  };
}

const SkillsContent: React.FC = () => {
  const client = usePluginClient(AiApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    aiAccess.skillRead,
  );
  const { allowed: canCreate } = accessApi.useAccess(aiAccess.skillCreate);
  const { allowed: canManage } = accessApi.useAccess(aiAccess.skillManage);

  const query = client.listSkills.useQuery();
  const skills = query.data?.skills ?? [];

  const [form, setForm] = React.useState<SkillFormState | undefined>();
  const [editingId, setEditingId] = React.useState<string | undefined>();
  const [pendingDelete, setPendingDelete] = React.useState<AiSkill | undefined>();
  // The skill whose full details (prompts, output fields) are open in a modal.
  const [viewing, setViewing] = React.useState<AiSkill | undefined>();

  const createMutation = client.createSkill.useMutation({
    onSuccess: () => {
      toast.success("Skill created");
      setForm(undefined);
    },
    onError: (e) => toast.error(extractErrorMessage(e)),
  });
  const updateMutation = client.updateSkill.useMutation({
    onSuccess: () => {
      toast.success("Skill updated");
      setForm(undefined);
      setEditingId(undefined);
    },
    onError: (e) => toast.error(extractErrorMessage(e)),
  });
  const deleteMutation = client.deleteSkill.useMutation({
    onSuccess: () => {
      toast.success("Skill deleted");
      setPendingDelete(undefined);
    },
    onError: (e) => toast.error(extractErrorMessage(e)),
  });

  const startCreate = () => {
    setEditingId(undefined);
    setForm({ ...EMPTY_FORM });
  };
  const startEdit = (skill: AiSkill) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      targets: skill.targets,
      systemPrompt: skill.systemPrompt ?? "",
      promptTemplate: skill.promptTemplate ?? "",
    });
  };
  const toggleTarget = (target: AiSkillTarget) => {
    setForm((f) =>
      f
        ? {
            ...f,
            targets: f.targets.includes(target)
              ? f.targets.filter((t) => t !== target)
              : [...f.targets, target],
          }
        : f,
    );
  };
  const submit = () => {
    if (!form) return;
    if (!form.name.trim() || !form.description.trim() || form.targets.length === 0) {
      toast.error("Name, description, and at least one target are required.");
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...toInput(form) });
    } else {
      createMutation.mutate(toInput(form));
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageLayout
      title="AI skills"
      subtitle="Reusable prompt templates for the chat assistant and the AI Analyze action. Builtin skills ship with the platform; you can publish your own for everyone to use."
      icon={Lightbulb}
      loading={accessLoading}
      allowed={canRead}
      actions={
        canCreate && !form ? (
          <Button size="sm" onClick={startCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New skill
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {form && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {editingId ? "Edit skill" : "New skill"}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setForm(undefined);
                  setEditingId(undefined);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Incident commander"
                />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What this skill is for and when to use it"
                />
              </div>
              <div className="space-y-1">
                <Label>Targets</Label>
                <div className="flex gap-4">
                  {TARGETS.map((t) => (
                    <label
                      key={t.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={form.targets.includes(t.value)}
                        onCheckedChange={() => toggleTarget(t.value)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>System prompt</Label>
                <Textarea
                  rows={4}
                  value={form.systemPrompt}
                  onChange={(e) =>
                    setForm({ ...form, systemPrompt: e.target.value })
                  }
                  placeholder="Guidance folded into the system prompt when this skill is active."
                />
              </div>
              <div className="space-y-1">
                <Label>Starter prompt (optional)</Label>
                <Textarea
                  rows={3}
                  value={form.promptTemplate}
                  onChange={(e) =>
                    setForm({ ...form, promptTemplate: e.target.value })
                  }
                  placeholder="Seeded into the composer / analyze prompt to help the operator start."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={submit} disabled={saving}>
                  {editingId ? "Save changes" : "Create skill"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {query.isLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : query.isError ? (
          <QueryErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : skills.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="h-8 w-8 text-muted-foreground" />}
            title="No skills yet"
            description="Publish a reusable prompt so you and your teammates can start from it in chat or the AI Analyze action."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {skills.map((skill) => (
              <Card
                key={skill.id}
                className="flex cursor-pointer flex-col transition-colors hover:border-primary"
                onClick={() => setViewing(skill)}
              >
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base leading-snug">
                    {skill.name}
                  </CardTitle>
                  <Badge variant={skill.source === "builtin" ? "outline" : "secondary"}>
                    {skill.source === "builtin" ? "Builtin" : "User"}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {skill.description}
                  </p>
                  <div className="flex gap-1">
                    {skill.targets.map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">
                        {t === "chat" ? "Chat" : "Analyze"}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Skill details: full prompts + output fields. Edit/Delete (user skills)
          live here so the cards stay clean and the whole card is clickable. */}
      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(undefined)}
      >
        <DialogContent className="max-w-2xl">
          {viewing && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle>{viewing.name}</DialogTitle>
                  <Badge
                    variant={viewing.source === "builtin" ? "outline" : "secondary"}
                  >
                    {viewing.source === "builtin" ? "Builtin" : "User"}
                  </Badge>
                </div>
                <DialogDescription>{viewing.description}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
                <div className="space-y-1">
                  <Label>Targets</Label>
                  <div className="flex gap-1">
                    {viewing.targets.map((t) => (
                      <Badge key={t} variant="outline" className="font-normal">
                        {t === "chat" ? "Chat assistant" : "AI Analyze action"}
                      </Badge>
                    ))}
                  </div>
                </div>
                {viewing.systemPrompt && (
                  <div className="space-y-1">
                    <Label>System prompt</Label>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {viewing.systemPrompt}
                    </pre>
                  </div>
                )}
                {viewing.promptTemplate && (
                  <div className="space-y-1">
                    <Label>Starter prompt</Label>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                      {viewing.promptTemplate}
                    </pre>
                  </div>
                )}
                {viewing.suggestedOutputFields &&
                  viewing.suggestedOutputFields.length > 0 && (
                    <div className="space-y-1">
                      <Label>Suggested output fields (AI Analyze)</Label>
                      <ul className="space-y-1">
                        {viewing.suggestedOutputFields.map((f) => (
                          <li
                            key={f.key}
                            className="rounded-md border px-3 py-2"
                          >
                            <span className="font-mono">{f.key}</span>{" "}
                            <Badge variant="outline" className="font-normal">
                              {f.type}
                            </Badge>
                            <p className="text-muted-foreground">
                              {f.description}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
              {viewing.source === "user" && canManage && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const target = viewing;
                      setViewing(undefined);
                      startEdit(target);
                    }}
                  >
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setPendingDelete(viewing);
                      setViewing(undefined);
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(undefined)}
        title="Delete skill"
        message={`Delete "${pendingDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate({ id: pendingDelete.id });
        }}
      />
    </PageLayout>
  );
};

export const SkillsPage = wrapInSuspense(SkillsContent);
