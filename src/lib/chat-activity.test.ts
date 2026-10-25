import { describe, expect, it } from "vitest";
import { answerPreview, chatActivity } from "./chat-activity";

describe("answerPreview", () => {
  it("flattens Markdown to one line of text", () => {
    expect(answerPreview("## 主题\n\n**作者**认为：\n- 第一点\n> 引文")).toBe("主题 作者认为： 第一点 引文");
  });

  it("keeps the text of links and Citations", () => {
    expect(answerPreview("书中写道 [风起于青萍之末](cite:3)。")).toBe("书中写道 风起于青萍之末。");
  });

  it("drops code blocks, including one still streaming", () => {
    expect(answerPreview("看这里\n```js\nlet a = 1;\n```\n然后")).toBe("看这里 然后");
    expect(answerPreview("看这里\n```js\nlet a")).toBe("看这里");
  });

  it("truncates long answers with an ellipsis", () => {
    expect(answerPreview("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("chatActivity", () => {
  it("previews the latest answer, past transcript markers", () => {
    expect(
      chatActivity(
        [
          { role: "user", content: "问" },
          { role: "assistant", content: "答" },
          { role: "notice", summary: "", tokensBefore: 0 },
        ],
        false,
      ),
    ).toEqual({ answering: false, preview: "答", failed: false });
  });

  it("has no preview while the question waits for its answer", () => {
    expect(chatActivity([{ role: "user", content: "问" }], true)).toEqual({
      answering: true,
      preview: "",
      failed: false,
    });
  });

  it("reports an answer that ended in an error", () => {
    expect(
      chatActivity([{ role: "assistant", content: "", stopReason: "error" }], false).failed,
    ).toBe(true);
  });
});
