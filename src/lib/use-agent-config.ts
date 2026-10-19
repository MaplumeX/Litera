import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConfigSnapshot, ChatgptAccount, CustomProviderEntry } from "@/types/agent-config";
import { invokeErrorMessage, isInvokeAppError } from "@/lib/app-error";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";

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
      embeddedAgentRuntime.invalidateConfig();
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const addCustomProvider = useCallback(
    async (name: string, baseUrl: string, apiKey: string, models: string[], imageInput: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const entry = await invoke<CustomProviderEntry>("add_custom_provider", {
          name,
          baseUrl,
          apiKey,
          models,
          imageInput,
        });
        embeddedAgentRuntime.invalidateConfig();
        await load();
        return entry;
      } catch (err) {
        setError(invokeErrorMessage(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const deleteCustomProvider = useCallback(
    async (id: string) => {
      setSaving(true);
      setError(null);
      try {
        await invoke("delete_custom_provider", { providerId: id });
        embeddedAgentRuntime.invalidateConfig();
        await load();
      } catch (err) {
        setError(invokeErrorMessage(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const updateCustomProvider = useCallback(
    async (id: string, name: string, baseUrl: string, apiKey: string, models: string[], imageInput: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const entry = await invoke<CustomProviderEntry>("update_custom_provider", {
          providerId: id,
          name,
          baseUrl,
          apiKey,
          models,
          imageInput,
        });
        embeddedAgentRuntime.invalidateConfig();
        await load();
        return entry;
      } catch (err) {
        setError(invokeErrorMessage(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const switchProvider = useCallback(
    async (providerId: string, model: string) => {
      setSaving(true);
      setError(null);
      try {
        await invoke("switch_provider", { providerId, model });
        embeddedAgentRuntime.invalidateConfig();
        await load();
      } catch (err) {
        setError(invokeErrorMessage(err));
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const [signingIn, setSigningIn] = useState(false);

  /** Opens the browser for Sign in with ChatGPT and resolves once tokens are saved. */
  const chatgptLogin = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      const account = await invoke<ChatgptAccount>("chatgpt_login");
      embeddedAgentRuntime.invalidateConfig();
      await load();
      return account;
    } catch (err) {
      if (!(isInvokeAppError(err) && err.code === "Cancelled")) setError(invokeErrorMessage(err));
      throw err;
    } finally {
      setSigningIn(false);
    }
  }, [load]);

  const chatgptCancelLogin = useCallback(async () => {
    await invoke("chatgpt_cancel_login");
  }, []);

  const chatgptLogout = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("chatgpt_logout");
      embeddedAgentRuntime.invalidateConfig();
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const listRemoteModels = useCallback(
    async (baseUrl: string, apiKey: string, providerId?: string) => {
      return invoke<string[]>("list_remote_models", {
        baseUrl,
        apiKey,
        providerId: providerId ?? null,
      });
    },
    [],
  );

  return {
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
  };
}
