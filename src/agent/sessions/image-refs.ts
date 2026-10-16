import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

/**
 * Book images never enter the Session file: a base64 image would blow the
 * per-line size cap and bloat sync. A persisted tool result keeps an Image
 * reference text in place of each image block, and the runtime re-reads the
 * image from the open Book right before each model request. The reference
 * text doubles as what a model sees when the image cannot be restored (no
 * vision input, or the Book changed).
 */
const IMAGE_REF = /^\[Image (.+) was viewed earlier; call view_image again to see it\.\]$/;

export function imageRefText(src: string): string {
  return `[Image ${src} was viewed earlier; call view_image again to see it.]`;
}

/** The image `src` an Image reference text points at, if `text` is one. */
export function imageRefSource(text: string): string | undefined {
  return IMAGE_REF.exec(text)?.[1];
}

/** Content with every image block of `src`-tagged results swapped for its Image reference text. */
function storedContent(content: readonly (TextContent | ImageContent)[], src: string): (TextContent | ImageContent)[] {
  return content.map((block) => (block.type === "image" ? { type: "text", text: imageRefText(src) } : block));
}

/**
 * The Session form of a message: image blocks of a tool result whose
 * `details.src` names a Book image become Image reference texts. Anything
 * else is returned unchanged.
 */
export function withImageRefs<T>(message: T): T {
  const result = message as unknown as { role?: unknown; content?: unknown; details?: unknown };
  const src = (result.details as { src?: unknown } | undefined)?.src;
  if (result.role !== "toolResult" || typeof src !== "string" || !Array.isArray(result.content)) return message;
  if (!result.content.some((block) => (block as { type?: unknown })?.type === "image")) return message;
  return { ...result, content: storedContent(result.content as (TextContent | ImageContent)[], src) } as T;
}

/**
 * Restore the images behind Image reference texts in tool results. `load`
 * failures leave the reference text in place, so the request still goes out.
 */
export async function restoreImageRefs(messages: Message[], load: (src: string) => Promise<ImageContent>): Promise<Message[]> {
  return Promise.all(messages.map(async (message) => {
    if (message.role !== "toolResult") return message;
    if (!message.content.some((block) => block.type === "text" && imageRefSource(block.text))) return message;
    const content = await Promise.all(message.content.map(async (block) => {
      const src = block.type === "text" ? imageRefSource(block.text) : undefined;
      if (!src) return block;
      try {
        return await load(src);
      } catch {
        return block;
      }
    }));
    return { ...message, content };
  }));
}
