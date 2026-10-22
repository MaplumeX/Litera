import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Switch } from "@/components/ui/switch";
import { useAgentConfig } from "@/lib/use-agent-config";
import { invokeErrorMessage } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import {
  AGENT_PROVIDERS,
  CHATGPT_PROVIDER_ID,
  findProviderExample,
  isCustomProviderId,
} from "@/types/agent-config";
import { listBuiltinModelIds } from "@/agent/runtime/model-resolution";
import { useT, type MessageKey } from "@/lib/i18n";

export interface AgentConfigFormProps {
  active?: boolean;
  onClose?: () => void;
}

function sameModels(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isLocalBaseUrl(url: string) {
  return /localhost|127\.0\.0\.1/.test(url);
}

/** Select value for the "add a custom provider" entry; never persisted. */
const NEW_CUSTOM = "__new_custom__";

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
    chatgptLogin,
    chatgptCancelLogin,
    chatgptLogout,
    loading,
    saving,
    signingIn,
    error,
  } = useAgentConfig();

  const seededRef = useRef(false);

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customImageInput, setCustomImageInput] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [catalogModels, setCatalogModels] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      seededRef.current = false;
      setDeleteOpen(false);
      setSuccessMessage(null);
      setRefreshError(null);
      return;
    }
    setSuccessMessage(null);
    setRefreshError(null);
    void load();
  }, [active, load]);

  const fillCustomFields = (name: string, baseUrl: string, models: string[], imageInput = false) => {
    setCustomName(name);
    setCustomBaseUrl(baseUrl);
    setCustomModels(models);
    setCustomImageInput(imageInput);
  };

  useEffect(() => {
    if (!active || !snapshot || seededRef.current) return;
    const currentProvider = snapshot.provider ?? AGENT_PROVIDERS[0].id;
    setProvider(currentProvider);
    setApiKey("");
    if (isCustomProviderId(currentProvider)) {
      const cp = snapshot.customProviders.find((entry) => entry.id === currentProvider);
      if (cp) {
        fillCustomFields(cp.name, cp.baseUrl, cp.models, cp.imageInput);
        setModel(
          snapshot.model && cp.models.includes(snapshot.model)
            ? snapshot.model
            : (cp.models[0] ?? ""),
        );
      } else {
        fillCustomFields("", "", []);
        setModel("");
      }
    } else {
      fillCustomFields("", "", []);
      setModel(snapshot.model ?? "");
    }
    seededRef.current = true;
  }, [active, snapshot]);

  const selectedCustom = isCustomProviderId(provider)
    ? snapshot?.customProviders.find((entry) => entry.id === provider) ?? null
    : null;
  const isNewCustom = provider === NEW_CUSTOM;
  const isCustom = selectedCustom !== null || isNewCustom;
  const isChatgpt = provider === CHATGPT_PROVIDER_ID;
  const chatgptAccount = snapshot?.chatgptAccount ?? null;
  // The plan's own listing when sign-in fetched one, else the OpenAI catalog.
  const chatgptModels = chatgptAccount?.models.length ? chatgptAccount.models : catalogModels;
  const hasExistingKey = selectedCustom
    ? selectedCustom.hasApiKey
    : isChatgpt
      ? chatgptAccount !== null
      : !isNewCustom && (snapshot?.providersWithKey.includes(provider) ?? false);

  useEffect(() => {
    if (!isChatgpt) return;
    let cancelled = false;
    void listBuiltinModelIds(CHATGPT_PROVIDER_ID).then((ids) => {
      if (!cancelled) setCatalogModels(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [isChatgpt]);
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
    if (value === NEW_CUSTOM) {
      fillCustomFields("", "", []);
      setModel("");
    } else if (isCustomProviderId(value)) {
      const cp = snapshot?.customProviders.find((entry) => entry.id === value);
      if (cp) {
        fillCustomFields(cp.name, cp.baseUrl, cp.models, cp.imageInput);
        setModel(
          snapshot?.provider === value && snapshot.model && cp.models.includes(snapshot.model)
            ? snapshot.model
            : (cp.models[0] ?? ""),
        );
      }
    } else {
      fillCustomFields("", "", []);
      setModel(snapshot?.model && snapshot.provider === value ? snapshot.model : "");
    }
  };

  const selectCatalogModel = (id: string) => {
    if (!customModels.includes(id)) {
      setCustomModels([...customModels, id]);
    }
    setModel(id);
  };

  const handleRefresh = async () => {
    if (!customBaseUrl.trim()) return;
    if (!apiKey.trim() && !hasExistingKey) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const ids = await listRemoteModels(customBaseUrl.trim(), apiKey.trim(), selectedCustom?.id);
      setCustomModels(ids);
      if (!ids.includes(model)) {
        setModel(ids[0] ?? "");
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
      if (isChatgpt) {
        await switchProvider(CHATGPT_PROVIDER_ID, model);
      } else if (isNewCustom) {
        const entry = await addCustomProvider(customName, customBaseUrl, apiKey, customModels, customImageInput);
        // Point at the created entry so a failed switch retries it instead of adding a duplicate.
        setProvider(entry.id);
        setApiKey("");
        await switchProvider(entry.id, model);
      } else if (selectedCustom) {
        const unchanged =
          customName === selectedCustom.name &&
          customBaseUrl === selectedCustom.baseUrl &&
          apiKey === "" &&
          sameModels(customModels, selectedCustom.models) &&
          customImageInput === selectedCustom.imageInput;
        if (!unchanged) {
          await updateCustomProvider(
            selectedCustom.id,
            customName,
            customBaseUrl,
            apiKey,
            customModels,
            customImageInput,
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
    setSuccessMessage(null);
    try {
      await deleteCustomProvider(deletedId);
      setDeleteOpen(false);
      setProvider(AGENT_PROVIDERS[0].id);
      setModel("");
      setApiKey("");
      fillCustomFields("", "", []);
      setSuccessMessage(t("agent.deletedCustom"));
    } catch {
      // error state is surfaced from the hook
    }
  };

  const handleChatgptLogin = async () => {
    setSuccessMessage(null);
    try {
      const account = await chatgptLogin();
      if (!model) setModel(account.models[0] ?? "");
    } catch {
      // error state is surfaced from the hook; cancelling is silent
    }
  };

  const handleChatgptLogout = async () => {
    setSuccessMessage(null);
    try {
      await chatgptLogout();
    } catch {
      // error state is surfaced from the hook
    }
  };

  const canRefresh =
    isCustom && customBaseUrl.trim() !== "" && (apiKey.trim() !== "" || hasExistingKey);

  return (
    <>
      {loading && (
        <p className="mb-3 text-xs text-muted-foreground">{t("agent.loading")}</p>
      )}

      <div className="space-y-3">
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
              <SelectSeparator />
              <SelectItem value={NEW_CUSTOM}>
                <Plus className="size-4" />
                {t("agent.addCustom")}
              </SelectItem>
            </SelectContent>
          </Select>
          {isNewCustom && (
            <p className="mt-1 text-xs text-muted-foreground">{t("agent.addCustomTitle")}</p>
          )}
        </Field>

        {isCustom && (
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
          </>
        )}

        {isChatgpt ? (
          <Field label={t("agent.chatgptAccount")}>
            {chatgptAccount ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm">
                  {chatgptAccount.email
                    ? t("agent.chatgptSignedIn", { email: chatgptAccount.email })
                    : t("agent.chatgptSignedInNoEmail")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleChatgptLogout()}
                  disabled={saving || signingIn}
                >
                  {t("agent.chatgptSignOut")}
                </Button>
              </div>
            ) : signingIn ? (
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {t("agent.chatgptSigningIn")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void chatgptCancelLogin()}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={() => void handleChatgptLogin()}
                disabled={saving}
              >
                {t("agent.chatgptSignIn")}
              </Button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("agent.chatgptHint")}</p>
          </Field>
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

        <Field label={t("agent.model")}>
          {isCustom ? (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ModelCombobox
                  models={customModels}
                  value={model}
                  disabled={saving}
                  onSelect={selectCatalogModel}
                />
              </div>
              <RefreshRow
                disabled={saving || refreshing || !canRefresh}
                refreshing={refreshing}
                error={refreshError}
                onRefresh={() => void handleRefresh()}
                t={t}
              />
            </div>
          ) : isChatgpt ? (
            <ModelCombobox
              models={chatgptModels}
              value={model}
              disabled={saving || !chatgptAccount}
              onSelect={setModel}
            />
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

        {isCustom && (
          <label className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">{t("agent.imageInput")}</div>
              <div className="text-[11px] text-muted-foreground/80">{t("agent.imageInputHint")}</div>
            </div>
            <Switch
              checked={customImageInput}
              disabled={saving}
              onCheckedChange={setCustomImageInput}
            />
          </label>
        )}
      </div>

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

      <div className="mt-5 flex items-center gap-2">
        {selectedCustom && (
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
        )}
        <div className="ml-auto flex gap-2">
          {onClose && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
          )}
          <Button size="sm" onClick={() => void handleApply()} disabled={saving || !canApply}>
            {saving ? t("agent.saving") : t("agent.apply")}
          </Button>
        </div>
      </div>

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

function ModelCombobox({
  models,
  value,
  onSelect,
  disabled = false,
}: {
  models: string[];
  value: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const canCreate = trimmed !== "" && !models.includes(trimmed);

  const pick = (id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={t("agent.model")}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>
            {value || t("agent.enterModelId")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput
            placeholder={t("agent.modelSearch")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{t("agent.modelEmpty")}</CommandEmpty>
            <CommandGroup>
              {models.map((id) => (
                <CommandItem key={id} value={id} onSelect={() => pick(id)}>
                  <CheckIcon
                    className={cn("size-4", value === id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="min-w-0 truncate font-mono text-xs">{id}</span>
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem
                  value={trimmed}
                  keywords={[trimmed]}
                  onSelect={() => pick(trimmed)}
                >
                  {t("agent.useModelId", { id: trimmed })}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
