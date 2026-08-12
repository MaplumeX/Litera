import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConfigSnapshot } from "@/types/agent-config";
import { invokeErrorMessage } from "@/lib/app-error";

export function useAgentConfig() {
  const [snapshot, setSnapshot] = useState<AgentConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<AgentConfigSnapshot>("get_agent_config");
      setSnapshot(result);
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (provider: string, apiKey: string, model: string) => {
    setSaving(true);
    setError(null);
    try {
      await invoke("save_agent_config", { provider, apiKey, model });
      await invoke("restart_sidecar");
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { snapshot, load, save, loading, saving, error };
}