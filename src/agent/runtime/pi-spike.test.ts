import { describe, expect, it } from "vitest";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";

function createToolAgent() {
  const faux = createFauxCore({ tokensPerSecond: 10_000 });
  const tool: AgentTool = {
    name: "probe",
    label: "Probe",
    description: "Return the marker",
    parameters: Type.Object({ marker: Type.String() }),
    execute: async (_id, { marker }) => ({
      content: [{ type: "text", text: marker }],
      details: { marker },
    }),
  };
  const agent = new Agent({
    initialState: {
      model: faux.getModel(),
      systemPrompt: "probe",
      thinkingLevel: "off",
      tools: [tool],
    },
    streamFn: faux.streamSimple,
  });
  return { agent, faux };
}

describe("Pi WebView compatibility spike", () => {
  it("streams text and executes a tool through Agent", async () => {
    const { agent, faux } = createToolAgent();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("probe", { marker: "tool-ok" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("stream-ok")]),
    ]);
    const events: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });

    await agent.prompt("run the probe");

    expect(events).toContain("message_update");
    expect(events).toContain("tool_execution_start");
    expect(events).toContain("tool_execution_end");
    expect(agent.state.messages.some((message) => message.role === "toolResult")).toBe(true);
    expect(agent.state.messages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("aborts an active streamed response", async () => {
    const faux = createFauxCore({ tokensPerSecond: 1, tokenSize: { min: 1, max: 1 } });
    faux.setResponses([fauxAssistantMessage("a deliberately slow streamed response")]);
    const agent = new Agent({
      initialState: {
        model: faux.getModel(),
        systemPrompt: "probe",
        thinkingLevel: "off",
        tools: [],
      },
      streamFn: faux.streamSimple,
    });
    let sawDelta = false;
    agent.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        sawDelta = true;
        agent.abort();
      }
    });

    await agent.prompt("start");

    expect(sawDelta).toBe(true);
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted",
    });
  });
});
