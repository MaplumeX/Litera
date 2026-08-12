import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentConfig } from "@/lib/use-agent-config";
import {
  AGENT_PROVIDERS,
  findProviderExample,
  isCustomProviderId,
  type CustomProviderEntry,
} from "@/types/agent-config";

const ADD_CUSTOM_VALUE = "__add_custom__";
const SEPARATOR_VALUE = "__separator__";

interface AgentConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AgentConfigDialog({ open, onClose }: AgentConfigDialogProps) {
  const {
    snapshot,
    load,
    save,
    addCustomProvider,
    updateCustomProvider,
    deleteCustomProvider,
    switchProvider,
    loading,
    saving,
    error,
  } = useAgentConfig();

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCustom, setEditingCustom] = useState(false);

  // Add-form fields
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModel, setNewModel] = useState("");

  // Edit-form fields
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editModel, setEditModel] = useState("");

  // Load current config whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSuccessMessage(null);
    setShowAddForm(false);
    setEditingCustom(false);
    setNewName("");
    setNewBaseUrl("");
    setNewApiKey("");
    setNewModel("");
    void load();
  }, [open, load]);

  // Pre-fill fields once the snapshot arrives.
  useEffect(() => {
    if (!open || !snapshot) return;
    const currentProvider = snapshot.provider ?? AGENT_PROVIDERS[0].id;
    setProvider(currentProvider);
    setModel(snapshot.model ?? "");
    setApiKey("");
  }, [open, snapshot]);

  if (!open) return null;

  const selectedCustom = isCustomProviderId(provider)
    ? snapshot?.customProviders.find((p) => p.id === provider) ?? null
    : null;

  const isCustom = selectedCustom !== null;
  const hasExistingKey = snapshot?.hasApiKey ?? false;
  const apiKeyPlaceholder = hasExistingKey
    ? "已配置（重新输入以修改）"
    : "输入 API Key";
  const modelPlaceholder = isCustom
    ? selectedCustom?.model ?? ""
    : findProviderExample(provider) || "输入 model id";

  const handleProviderChange = (value: string) => {
    setSuccessMessage(null);
    if (value === ADD_CUSTOM_VALUE) {
      setShowAddForm(true);
      return;
    }
    setShowAddForm(false);
    setEditingCustom(false);
    setProvider(value);
    if (isCustomProviderId(value)) {
      const cp = snapshot?.customProviders.find((p) => p.id === value);
      if (cp) {
        setModel(cp.model);
        // R1: selecting a custom provider switches immediately.
        void handleSwitchTo(cp);
      }
    } else {
      setModel(snapshot?.model && snapshot.provider === value ? snapshot.model : "");
    }
  };

  const handleSave = async () => {
    if (!provider || !model) return;
    if (!apiKey && !hasExistingKey) return;
    setSuccessMessage(null);
    try {
      await save(provider, apiKey, model);
      setSuccessMessage("保存成功");
      setTimeout(() => onClose(), 800);
    } catch {
      // error state is surfaced from the hook
    }
  };

  const handleSwitchTo = async (cp: CustomProviderEntry) => {
    setSuccessMessage(null);
    try {
      await switchProvider(cp.id, cp.model);
      setSuccessMessage("已切换，重启 sidecar 生效");
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch {
      // error state is surfaced from the hook
    }
  };

  const startEdit = () => {
    if (!selectedCustom) return;
    setEditName(selectedCustom.name);
    setEditBaseUrl(selectedCustom.baseUrl);
    setEditApiKey("");
    setEditModel(selectedCustom.model);
    setEditingCustom(true);
  };

  const handleEditSave = async () => {
    if (!selectedCustom || !editName || !editBaseUrl || !editModel) return;
    setSuccessMessage(null);
    try {
      const entry = await updateCustomProvider(
        selectedCustom.id,
        editName,
        editBaseUrl,
        editApiKey,
        editModel,
      );
      setEditingCustom(false);
      setModel(entry.model);
      setSuccessMessage("已保存，重启 sidecar 生效");
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch {
      // error state is surfaced from the hook
    }
  };

  const handleDelete = async () => {
    if (!selectedCustom) return;
    setSuccessMessage(null);
    try {
      await deleteCustomProvider(selectedCustom.id);
      setProvider(AGENT_PROVIDERS[0].id);
      setModel("");
      setEditingCustom(false);
      setSuccessMessage("已删除自定义供应商");
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch {
      // error state is surfaced from the hook
    }
  };

  const isLocalBaseUrl = (url: string) =>
    /localhost|127\.0\.0\.1/.test(url);

  const handleAddCustom = async () => {
    if (!newName || !newBaseUrl || !newApiKey || !newModel) return;
    setSuccessMessage(null);
    try {
      const entry = await addCustomProvider(newName, newBaseUrl, newApiKey, newModel);
      setShowAddForm(false);
      setNewName("");
      setNewBaseUrl("");
      setNewApiKey("");
      setNewModel("");
      setProvider(entry.id);
      setModel(entry.model);
      // The new provider is now selected — switch to it immediately.
      await switchProvider(entry.id, entry.model);
      setSuccessMessage("已添加并切换，重启 sidecar 生效");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      // error state is surfaced from the hook
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-lg border bg-popover p-5 shadow-lg",
          "max-h-[85vh] overflow-y-auto",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">LLM 设置</h2>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
            ✕
          </Button>
        </div>

        {loading && (
          <p className="mb-3 text-xs text-muted-foreground">加载中…</p>
        )}

        <div className="space-y-4">
          {/* Provider */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Provider
            </label>
            <select
              value={showAddForm ? ADD_CUSTOM_VALUE : provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={saving}
              className={cn(
                "w-full rounded border bg-background px-2 py-1.5 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring",
                saving && "opacity-60",
              )}
            >
              {AGENT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {snapshot && snapshot.customProviders.length > 0 && (
                <option disabled value={SEPARATOR_VALUE}>
                  ────── 自定义 ──────
                </option>
              )}
              {snapshot?.customProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (自定义)
                </option>
              ))}
              <option value={ADD_CUSTOM_VALUE}>＋ 添加自定义供应商…</option>
            </select>
          </div>

          {/* Add custom provider form */}
          {showAddForm && (
            <div className="space-y-3 rounded border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">添加自定义 OpenAI 兼容供应商</p>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">名称</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="如：本地 Ollama"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Base URL</label>
                <input
                  type="text"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder="如：http://localhost:11434/v1"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">API Key</label>
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder={isLocalBaseUrl(newBaseUrl) ? "本地服务填任意占位值" : "输入 API Key"}
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Model</label>
                <input
                  type="text"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="如：llama-3.1"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddForm(false)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleAddCustom()}
                  disabled={saving || !newName || !newBaseUrl || !newApiKey || !newModel}
                >
                  {saving ? "添加中…" : "添加"}
                </Button>
              </div>
            </div>
          )}

          {/* Custom provider: read-only info + actions */}
          {isCustom && !showAddForm && !editingCustom && selectedCustom && (
            <div className="space-y-3">
              <div className="rounded border border-border bg-muted/30 p-3 space-y-1.5">
                <div className="text-sm font-medium">{selectedCustom.name}</div>
                <div className="text-xs text-muted-foreground">
                  Base URL: <span className="font-mono">{selectedCustom.baseUrl}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Model: <span className="font-mono">{selectedCustom.model}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  API Key: {selectedCustom.hasApiKey ? "已配置" : "未配置"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startEdit}
                  disabled={saving}
                >
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  aria-label="删除自定义供应商"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </div>
            </div>
          )}

          {/* Custom provider: edit form */}
          {isCustom && !showAddForm && editingCustom && selectedCustom && (
            <div className="space-y-3 rounded border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">编辑自定义供应商</p>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="如：本地 Ollama"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Base URL</label>
                <input
                  type="text"
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  placeholder="如：http://localhost:11434/v1"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">API Key</label>
                <input
                  type="password"
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder={
                    selectedCustom.hasApiKey
                      ? "已配置，留空保持不变"
                      : isLocalBaseUrl(editBaseUrl)
                        ? "本地服务填任意占位值"
                        : "输入 API Key"
                  }
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Model</label>
                <input
                  type="text"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  placeholder="如：llama-3.1"
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingCustom(false)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleEditSave()}
                  disabled={saving || !editName || !editBaseUrl || !editModel}
                >
                  {saving ? "保存中…" : "保存"}
                </Button>
              </div>
            </div>
          )}

          {/* Built-in provider: apiKey + model inputs */}
          {!isCustom && !showAddForm && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyPlaceholder}
                  className={cn(
                    "w-full rounded border bg-background px-2 py-1.5 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
                {hasExistingKey && !apiKey && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    已保存 API Key，重新输入可替换。
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Model
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={modelPlaceholder}
                  className={cn(
                    "w-full rounded border bg-background px-2 py-1.5 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
              </div>
            </>
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

        {/* Save button only for built-in providers */}
        {!isCustom && !showAddForm && (
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !provider || !model || (!apiKey && !hasExistingKey)}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        )}

        {/* For custom provider view, only show close button */}
        {isCustom && !showAddForm && !editingCustom && (
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              关闭
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}