import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAgentConfig } from "@/lib/use-agent-config";
import { invokeErrorMessage } from "@/lib/app-error";
import {
  AGENT_PROVIDERS,
  findProviderExample,
  isCustomProviderId,
} from "@/types/agent-config";
import { useT, type MessageKey } from "@/lib/i18n";

export interface AgentConfigFormProps {
  active?: boolean;
  onClose?: () => void;
}

function sameModels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function mergeModelIds(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const raw of incoming) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isLocalBaseUrl(url: string) {
  return /localhost|127\.0\.0\.1/.test(url);
}

export function AgentConfigForm({ active = true, onClose }: AgentConfigFormProps) {
  const { t } = useT();
  const {
    snapshot,
    load,
    save,
    addCustomProvider,
    updateCustomProvider,
    deleteCustomProvider,
    switchProvider,
    listRemoteModels,
    loading,
    saving,
    error,
  } = useAgentConfig();

  const seededRef = useRef(false);

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState("");

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModels, setNewModels] = useState<string[]>([]);
  const [newModelDraft, setNewModelDraft] = useState("");

  useEffect(() => {
    if (!active) {
      seededRef.current = false;
      setShowAddForm(false);
      setDeleteOpen(false);
      setSuccessMessage(null);
      setRefreshError(null);
      return;
    }
    setSuccessMessage(null);
    setShowAddForm(false);
    setRefreshError(null);
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || !snapshot || seededRef.current) return;
    const currentProvider = snapshot.provider ?? AGENT_PROVIDERS[0].id;
    setProvider(currentProvider);
    setApiKey("");
    setModelDraft("");
    if (isCustomProviderId(currentProvider)) {
      const cp = snapshot.customProviders.find((entry) => entry.id === currentProvider);
      if (cp) {
        setCustomName(cp.name);
        setCustomBaseUrl(cp.baseUrl);
        setCustomModels(cp.models);
        setModel(
          snapshot.model && cp.models.includes(snapshot.model)
            ? snapshot.model
            : (cp.models[0] ?? ""),
        );
      } else {
        setCustomName("");
        setCustomBaseUrl("");
        setCustomModels([]);
        setModel("");
      }
    } else {
      setCustomName("");
      setCustomBaseUrl("");
      setCustomModels([]);
      setModel(snapshot.model ?? "");
    }
    seededRef.current = true;
  }, [active, snapshot]);

  const selectedCustom = isCustomProviderId(provider)
    ? snapshot?.customProviders.find((entry) => entry.id === provider) ?? null
    : null;
  const isCustom = selectedCustom !== null;
  const hasExistingKey = isCustom
    ? selectedCustom.hasApiKey
    : snapshot?.provider === provider && (snapshot?.hasApiKey ?? false);
  const apiKeyPlaceholder = hasExistingKey
    ? t("agent.apiKeyKeep")
    : isCustom && isLocalBaseUrl(customBaseUrl)
      ? t("agent.localApiKeyHint")
      : t("agent.enterApiKey");

  const canApply =
    !!provider &&
    !!model.trim() &&
    (hasExistingKey || !!apiKey.trim()) &&
    (!isCustom ||
      (customName.trim() !== "" &&
        customBaseUrl.trim() !== "" &&
        customModels.length > 0 &&
        customModels.includes(model)));

  const handleProviderChange = (value: string) => {
    setSuccessMessage(null);
    setRefreshError(null);
    setProvider(value);
    setApiKey("");
    setModelDraft("");
    if (isCustomProviderId(value)) {
      const cp = snapshot?.customProviders.find((entry) => entry.id === value);
      if (cp) {
        setCustomName(cp.name);
        setCustomBaseUrl(cp.baseUrl);
        setCustomModels(cp.models);
        setModel(
          snapshot?.provider === value && snapshot.model && cp.models.includes(snapshot.model)
            ? snapshot.model
            : (cp.models[0] ?? ""),
        );
      }
    } else {
      setCustomName("");
      setCustomBaseUrl("");
      setCustomModels([]);
      setModel(snapshot?.model && snapshot.provider === value ? snapshot.model : "");
    }
  };

  const addModelId = (
    draft: string,
    models: string[],
    setModels: (next: string[]) => void,
    setDraft: (next: string) => void,
    setCurrent: (next: string) => void,
  ) => {
    const id = draft.trim();
    if (!id) return;
    if (!models.includes(id)) {
      setModels([...models, id]);
    }
    setCurrent(id);
    setDraft("");
  };

  const removeModelId = (
    id: string,
    models: string[],
    setModels: (next: string[]) => void,
    current: string,
    setCurrent: (next: string) => void,
  ) => {
    if (models.length <= 1) return;
    const next = models.filter((item) => item !== id);
    setModels(next);
    if (current === id) {
      setCurrent(next[0] ?? "");
    }
  };

  const handleRefresh = async (opts: {
    baseUrl: string;
    draftKey: string;
    providerId?: string;
    hasSavedKey: boolean;
    currentModels: string[];
    currentModel: string;
    setModels: (next: string[]) => void;
    setCurrent: (next: string) => void;
  }) => {
    if (!opts.baseUrl.trim()) return;
    if (!opts.draftKey.trim() && !opts.hasSavedKey) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const ids = await listRemoteModels(
        opts.baseUrl.trim(),
        opts.draftKey.trim(),
        opts.providerId,
      );
      const merged = mergeModelIds(opts.currentModels, ids);
      opts.setModels(merged);
      if (!merged.includes(opts.currentModel)) {
        opts.setCurrent(merged[0] ?? "");
      }
    } catch (err) {
      setRefreshError(invokeErrorMessage(err) || t("agent.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  const handleApply = async () => {
    if (!canApply) return;
    setSuccessMessage(null);
    try {
      if (isCustom && selectedCustom) {
        const unchanged =
          customName === selectedCustom.name &&
          customBaseUrl === selectedCustom.baseUrl &&
          apiKey === "" &&
          sameModels(customModels, selectedCustom.models);
        if (!unchanged) {
          await updateCustomProvider(
            selectedCustom.id,
            customName,
            customBaseUrl,
            apiKey,
            customModels,
          );
        }
        await switchProvider(selectedCustom.id, model);
      } else {
        await save(provider, apiKey, model);
      }
      seededRef.current = false;
      setApiKey("");
      setSuccessMessage(t("agent.saved"));
      if (onClose) {
        setTimeout(() => onClose(), 800);
      }
    } catch {
      // error state is surfaced from the hook
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedCustom) return;
    const deletedId = selectedCustom.id;
    const wasActive = snapshot?.provider === deletedId;
    setSuccessMessage(null);
    try {
      await deleteCustomProvider(deletedId, { restart: wasActive });
      setDeleteOpen(false);
      setProvider(AGENT_PROVIDERS[0].id);
      setModel("");
      setApiKey("");
      setCustomName("");
      setCustomBaseUrl("");
      setCustomModels([]);
      setModelDraft("");
      setSuccessMessage(t("agent.deletedCustom"));
    } catch {
      // error state is surfaced from the hook
    }
  };

  const handleAddCustom = async () => {
    if (!newName.trim() || !newBaseUrl.trim() || !newApiKey.trim() || newModels.length === 0) {
      return;
    }
    setSuccessMessage(null);
    try {
      await addCustomProvider(newName, newBaseUrl, newApiKey, newModels);
      setShowAddForm(false);
      setNewName("");
      setNewBaseUrl("");
      setNewApiKey("");
      setNewModels([]);
      setNewModelDraft("");
      setRefreshError(null);
      setSuccessMessage(t("agent.added"));
    } catch {
      // error state is surfaced from the hook
    }
  };

  const canRefreshAdd = newBaseUrl.trim() !== "" && newApiKey.trim() !== "";
  const canRefreshCustom =
    isCustom &&
    customBaseUrl.trim() !== "" &&
    (apiKey.trim() !== "" || selectedCustom.hasApiKey);

  return (
    <>
      {loading && (
        <p className="mb-3 text-xs text-muted-foreground">{t("agent.loading")}</p>
      )}

      {showAddForm ? (
        <div className="space-y-3 rounded border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("agent.addCustomTitle")}</p>
          <Field label={t("agent.name")}>
            <Input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("agent.namePlaceholder")}
              className="w-full"
            />
          </Field>
          <Field label={t("agent.baseUrl")}>
            <Input
              type="text"
              value={newBaseUrl}
              onChange={(event) => setNewBaseUrl(event.target.value)}
              placeholder={t("agent.baseUrlPlaceholder")}
              className="w-full"
            />
          </Field>
          <Field label={t("agent.apiKey")}>
            <Input
              type="password"
              value={newApiKey}
              onChange={(event) => setNewApiKey(event.target.value)}
              placeholder={
                isLocalBaseUrl(newBaseUrl) ? t("agent.localApiKeyHint") : t("agent.enterApiKey")
              }
              className="w-full"
            />
          </Field>
          <ModelListEditor
            models={newModels}
            draft={newModelDraft}
            onDraftChange={setNewModelDraft}
            onAdd={() =>
              addModelId(newModelDraft, newModels, setNewModels, setNewModelDraft, () => {})
            }
            onRemove={(id) =>
              removeModelId(id, newModels, setNewModels, "", () => {})
            }
            allowEmpty
            disabled={saving}
            t={t}
          />
          <RefreshRow
            disabled={saving || refreshing || !canRefreshAdd}
            refreshing={refreshing}
            error={refreshError}
            onRefresh={() =>
              void handleRefresh({
                baseUrl: newBaseUrl,
                draftKey: newApiKey,
                hasSavedKey: false,
                currentModels: newModels,
                currentModel: "",
                setModels: setNewModels,
                setCurrent: () => {},
              })
            }
            t={t}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAddForm(false);
                setRefreshError(null);
              }}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleAddCustom()}
              disabled={
                saving ||
                !newName.trim() ||
                !newBaseUrl.trim() ||
                !newApiKey.trim() ||
                newModels.length === 0
              }
            >
              {saving ? t("agent.adding") : t("agent.add")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("agent.currentUse")}</h3>
            <Field label={t("agent.provider")}>
              <Select value={provider} onValueChange={handleProviderChange} disabled={saving}>
                <SelectTrigger className="w-full" disabled={saving}>
                  <SelectValue placeholder={t("agent.selectProvider")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {AGENT_PROVIDERS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {snapshot && snapshot.customProviders.length > 0 && (
                    <>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>{t("agent.custom")}</SelectLabel>
                        {snapshot.customProviders.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {t("agent.customSuffix", { name: entry.name })}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("agent.model")}>
              {isCustom ? (
                <Select
                  value={model}
                  onValueChange={setModel}
                  disabled={saving || customModels.length === 0}
                >
                  <SelectTrigger className="w-full" disabled={saving || customModels.length === 0}>
                    <SelectValue placeholder={t("agent.enterModelId")} />
                  </SelectTrigger>
                  <SelectContent>
                    {customModels.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={findProviderExample(provider) || t("agent.enterModelId")}
                  className="w-full"
                />
              )}
            </Field>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">{t("agent.thisProvider")}</h3>
            {isCustom && selectedCustom ? (
              <>
                <Field label={t("agent.name")}>
                  <Input
                    type="text"
                    value={customName}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder={t("agent.namePlaceholder")}
                    className="w-full"
                  />
                </Field>
                <Field label={t("agent.baseUrl")}>
                  <Input
                    type="text"
                    value={customBaseUrl}
                    onChange={(event) => setCustomBaseUrl(event.target.value)}
                    placeholder={t("agent.baseUrlPlaceholder")}
                    className="w-full"
                  />
                </Field>
                <Field label={t("agent.apiKey")}>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={apiKeyPlaceholder}
                    className="w-full"
                  />
                </Field>
                <ModelListEditor
                  models={customModels}
                  draft={modelDraft}
                  onDraftChange={setModelDraft}
                  onAdd={() =>
                    addModelId(modelDraft, customModels, setCustomModels, setModelDraft, setModel)
                  }
                  onRemove={(id) =>
                    removeModelId(id, customModels, setCustomModels, model, setModel)
                  }
                  disabled={saving}
                  t={t}
                />
                <RefreshRow
                  disabled={saving || refreshing || !canRefreshCustom}
                  refreshing={refreshing}
                  error={refreshError}
                  onRefresh={() =>
                    void handleRefresh({
                      baseUrl: customBaseUrl,
                      draftKey: apiKey,
                      providerId: selectedCustom.id,
                      hasSavedKey: selectedCustom.hasApiKey,
                      currentModels: customModels,
                      currentModel: model,
                      setModels: setCustomModels,
                      setCurrent: setModel,
                    })
                  }
                  t={t}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteOpen(true)}
                  disabled={saving}
                  aria-label={t("agent.deleteCustom")}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {t("common.delete")}
                </Button>
              </>
            ) : (
              <Field label={t("agent.apiKey")}>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={apiKeyPlaceholder}
                  className="w-full"
                />
                {hasExistingKey && !apiKey && (
                  <p className="mt-1 text-xs text-muted-foreground">{t("agent.apiKeySavedHint")}</p>
                )}
              </Field>
            )}
          </section>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          ⚠ {error}
        </div>
      )}
      {successMessage && (
        <div className="mt-3 rounded border border-green-500/50 bg-green-500/10 px-2 py-1 text-xs text-green-600">
          ✓ {successMessage}
        </div>
      )}

      {!showAddForm && (
        <div className="mt-5 flex justify-end gap-2">
          {onClose && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
          )}
          <Button size="sm" onClick={() => void handleApply()} disabled={saving || !canApply}>
            {saving ? t("agent.saving") : t("agent.apply")}
          </Button>
        </div>
      )}

      {!showAddForm && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowAddForm(true);
              setRefreshError(null);
              setSuccessMessage(null);
            }}
            disabled={saving}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("agent.addCustom")}
          </Button>
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agent.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("agent.deleteConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDeleteConfirm()}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ModelListEditor({
  models,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  allowEmpty = false,
  disabled,
  t,
}: {
  models: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  allowEmpty?: boolean;
  disabled: boolean;
  t: (key: MessageKey) => string;
}) {
  return (
    <div className="space-y-2">
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("agent.model")}
      </Label>
      <ul className="space-y-1">
        {models.map((id) => (
          <li key={id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => onRemove(id)}
              disabled={disabled || (!allowEmpty && models.length <= 1)}
              title={!allowEmpty && models.length <= 1 ? t("agent.cannotDeleteLast") : undefined}
              aria-label={t("agent.removeModel")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          type="text"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={t("agent.addModelPlaceholder")}
          className="w-full"
          disabled={disabled}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAdd}
          disabled={disabled || !draft.trim()}
        >
          {t("agent.addModel")}
        </Button>
      </div>
    </div>
  );
}

function RefreshRow({
  disabled,
  refreshing,
  error,
  onRefresh,
  t,
}: {
  disabled: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  t: (key: MessageKey) => string;
}) {
  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={disabled}>
        {refreshing ? t("agent.refreshing") : t("agent.refreshModels")}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
