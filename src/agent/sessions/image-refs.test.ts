import { describe, expect, it, vi } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import { imageRefSource, imageRefText, restoreImageRefs, withImageRefs } from "./image-refs";

const image = { type: "image" as const, data: "aW1n", mimeType: "image/png" };
const meta = { type: "text" as const, text: '{"src":"OPS/a b.png"}' };

function toolResult(content: Array<{ type: "text"; text: string } | typeof image>, details: unknown = { src: "OPS/a b.png" }): Message {
  return { role: "toolResult", toolCallId: "call1", toolName: "view_image", content, details, isError: false, timestamp: 1 } as Message;
}

describe("Image references", () => {
  it("round-trips a src, spaces included", () => {
    expect(imageRefSource(imageRefText("OPS/a b.png"))).toBe("OPS/a b.png");
    expect(imageRefSource("[Result of view_image(src=\"x\") was cleared to save context.]")).toBeUndefined();
  });

  it("swaps image blocks for reference texts before persisting", () => {
    expect(withImageRefs(toolResult([meta, image]))).toMatchObject({ content: [meta, { type: "text", text: imageRefText("OPS/a b.png") }] });
  });

  it("leaves messages without a Book image untouched", () => {
    const plain = toolResult([meta]);
    expect(withImageRefs(plain)).toBe(plain);
    const foreign = toolResult([image], {});
    expect(withImageRefs(foreign)).toBe(foreign);
    const user = { role: "user", content: [image], timestamp: 1 };
    expect(withImageRefs(user)).toBe(user);
  });

  it("restores referenced images and keeps the text when loading fails", async () => {
    const load = vi.fn(async (src: string) => {
      if (src === "gone.png") throw new Error("missing");
      return image;
    });
    const [restored, failed] = await restoreImageRefs(
      [toolResult([meta, { type: "text", text: imageRefText("OPS/a b.png") }]), toolResult([{ type: "text", text: imageRefText("gone.png") }])],
      load,
    );
    expect(restored).toMatchObject({ content: [meta, image] });
    expect(failed).toMatchObject({ content: [{ type: "text", text: imageRefText("gone.png") }] });
    expect(load).toHaveBeenCalledWith("OPS/a b.png");
  });
});
