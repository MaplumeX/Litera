import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  AGENT_PROVIDERS,
  findProviderExample,
  isCustomProviderId,
  type CustomProviderEntry,
} from "@/types/agent-config";

const ADD_CUSTOM_VALUE = "__add_custom__";

export interface AgentConfigFormProps {
  active?: boolean;
  onClose?: () => void;
}

export function AgentConfigForm({ active = true, onClose }: AgentConfigFormProps) {
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

  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModel, setNewModel] = useState("");

  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editModel, setEditModel] = useState("");

  useEffect(() => {
    if (!active) return;
    setSuccessMessage(null);
    setShowAddForm(false);
    setEditingCustom(false);
    setNewName("");
    setNewBaseUrl("");
    setNewApiKey("");
    setNewModel("");
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || !snapshot) return;
    const currentProvider = snapshot.provider ?? AGENT_PROVIDERS[0].id;
    setProvider(currentProvider);
    setModel(snapshot.model ?? "");
    setApiKey("");
  }, [active, snapshot]);

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
      if (onClose) {
        setTimeout(() => onClose(), 800);
      }
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
      await switchProvider(entry.id, entry.model);
      setSuccessMessage("已添加并切换，重启 sidecar 生效");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch {
      // error state is surfaced from the hook
    }
  };

  return (
    <>
      {loading && (
        <p className="mb-3 text-xs text-muted-foreground">加载中…</p>
      )}

      <div className="space-y-4">
        <div>
          <Label className="mb-1 block text-xs font-medium text-muted-foreground">
            Provider
          </Label>
          <Select
            value={showAddForm ? ADD_CUSTOM_VALUE : provider}
            onValueChange={handleProviderChange}
            disabled={saving}
          >
            <SelectTrigger className="w-full" disabled={saving}>
              <SelectValue placeholder="选择供应商" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {AGENT_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {snapshot && snapshot.customProviders.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>自定义</SelectLabel>
                    {snapshot.customProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} (自定义)
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
              <SelectSeparator />
              <SelectItem value={ADD_CUSTOM_VALUE}>
                ＋ 添加自定义供应商…
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showAddForm && (
          <div className="space-y-3 rounded border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">添加自定义 OpenAI 兼容供应商</p>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">名称</Label>
              <Input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如：本地 Ollama"
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Base URL</Label>
              <Input
                type="text"
                value={newBaseUrl}
                onChange={(e) => setNewBaseUrl(e.target.value)}
                placeholder="如：http://localhost:11434/v1"
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">API Key</Label>
              <Input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder={isLocalBaseUrl(newBaseUrl) ? "本地服务填任意占位值" : "输入 API Key"}
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Model</Label>
              <Input
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                placeholder="如：llama-3.1"
                className="w-full"
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

        {isCustom && !showAddForm && editingCustom && selectedCustom && (
          <div className="space-y-3 rounded border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">编辑自定义供应商</p>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">名称</Label>
              <Input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="如：本地 Ollama"
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Base URL</Label>
              <Input
                type="text"
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                placeholder="如：http://localhost:11434/v1"
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">API Key</Label>
              <Input
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
                className="w-full"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Model</Label>
              <Input
                type="text"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                placeholder="如：llama-3.1"
                className="w-full"
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

        {!isCustom && !showAddForm && (
          <>
            <div>
              <Label className="mb-1 block text-xs font-medium text-muted-foreground">
                API Key
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKeyPlaceholder}
                className="w-full"
              />
              {hasExistingKey && !apiKey && (
                <p className="mt-1 text-xs text-muted-foreground">
                  已保存 API Key，重新输入可替换。
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1 block text-xs font-medium text-muted-foreground">
                Model
              </Label>
              <Input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={modelPlaceholder}
                className="w-full"
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

      {!isCustom && !showAddForm && (
        <div className="mt-5 flex justify-end gap-2">
          {onClose && (
            <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !provider || !model || (!apiKey && !hasExistingKey)}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      )}

      {isCustom && !showAddForm && !editingCustom && onClose && (
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            关闭
          </Button>
        </div>
      )}
    </>
  );
}
