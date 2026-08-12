import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAgentConfig } from "@/lib/use-agent-config";
import {
  AGENT_PROVIDERS,
  findProviderExample,
} from "@/types/agent-config";

interface AgentConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AgentConfigDialog({ open, onClose }: AgentConfigDialogProps) {
  const { snapshot, load, save, loading, saving, error } = useAgentConfig();
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load current config whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSuccessMessage(null);
    setApiKey("");
    void load();
  }, [open, load]);

  // Pre-fill fields once the snapshot arrives.
  useEffect(() => {
    if (!open || !snapshot) return;
    setProvider(snapshot.provider ?? AGENT_PROVIDERS[0].id);
    setModel(snapshot.model ?? "");
  }, [open, snapshot]);

  if (!open) return null;

  const hasExistingKey = snapshot?.hasApiKey ?? false;
  const apiKeyPlaceholder = hasExistingKey
    ? "已配置（重新输入以修改）"
    : "输入 API Key";
  const modelPlaceholder = findProviderExample(provider) || "输入 model id";

  const handleSave = async () => {
    if (!provider || !model || !apiKey) return;
    setSuccessMessage(null);
    try {
      await save(provider, apiKey, model);
      setSuccessMessage("保存成功");
      // Brief delay so the user sees confirmation, then close.
      setTimeout(() => onClose(), 800);
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
        className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-lg"
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
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className={cn(
                "w-full rounded border bg-background px-2 py-1.5 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            >
              {AGENT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
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

          {/* Model */}
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

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !provider || !model || !apiKey}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}