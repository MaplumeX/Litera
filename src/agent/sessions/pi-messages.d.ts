import "@earendil-works/pi-agent-core";

// Session entries projected into agent context before convertPiContextToLlm
// turns them into provider messages. Register them with Pi's extension point.
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    custom: {
      role: "custom";
      customType: string;
      content: unknown;
      display: boolean;
      details?: unknown;
      timestamp: number;
    };
    branchSummary: {
      role: "branchSummary";
      summary: string;
      fromId: string;
      timestamp: number;
    };
    compactionSummary: {
      role: "compactionSummary";
      summary: string;
      tokensBefore: number;
      timestamp: number;
    };
  }
}
