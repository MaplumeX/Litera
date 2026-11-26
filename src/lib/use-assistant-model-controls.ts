import { useCallback, useEffect } from "react";
import { useAgentConfig } from "@/lib/use-agent-config";
import { invokeErrorMessage } from "@/lib/app-error";
import { useT } from "@/lib/i18n";
import { CHATGPT_PROVIDER_ID, isCustomProviderId } from "@/types/agent-config";

/**
 * Shared model-switcher and thinking-level orchestration for `ChatWorkspace` and `GuideWorkspace`.
 */
export function useAssistantModelControls(onError: (message: string | null) => void) {
  const { t } = useT();
  const { snapshot, load, switchProvider, setThinkingLevel } = useAgentConfig();

  useEffect(() => {
    void load();
  }, [load]);

  const thinkingLevel = snapshot?.thinkingLevel ?? "medium";

  const customModels =
    snapshot && snapshot.provider && isCustomProviderId(snapshot.provider)
      ? (snapshot.customProviders.find((entry) => entry.id === snapshot.provider)?.models ?? [])
      : snapshot?.provider === CHATGPT_PROVIDER_ID
        ? (snapshot.chatgptAccount?.models ?? [])
        : [];

  const handleModelSelect = useCallback(
    async (model: string) => {
      const provider = snapshot?.provider;
      if (!provider || !snapshot?.configured) return;
      onError(null);
      try {
        await switchProvider(provider, model);
      } catch (error) {
        onError(t("chat.switchModelFailed", { message: invokeErrorMessage(error) }));
      }
    },
    [onError, snapshot, switchProvider, t],
  );

  const handleThinkingLevelChange = useCallback(
    async (level: string) => {
      onError(null);
      try {
        await setThinkingLevel(level);
      } catch (error) {
        onError(String(error));
      }
    },
    [onError, setThinkingLevel],
  );

  return {
    configSnapshot: snapshot,
    thinkingLevel,
    customModels,
    handleModelSelect,
    handleThinkingLevelChange,
  };
}
