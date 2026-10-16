/** Formats every vision-capable provider accepts as-is. */
const MODEL_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** Longest side sent to the model; larger images cost tokens without adding detail. */
export const MODEL_IMAGE_MAX_SIDE = 1568;
/** Pixel budget: about 1.15 megapixels, ~1600 image tokens. */
export const MODEL_IMAGE_MAX_PIXELS = 1_150_000;
/** Ceiling for bytes passed through unconverted (providers cap single images around 5 MB of base64). */
export const MODEL_IMAGE_MAX_BYTES = 3_500_000;

/** One Book image ready to send to the model. */
export interface ModelImage {
  src: string;
  mimeType: string;
  /** Base64 image bytes. */
  data: string;
  width?: number;
  height?: number;
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Re-encode at `width`×`height` (already scaled) into `mimeType`; resolves the bytes and their actual type. */
  encode(width: number, height: number, mimeType: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
  close(): void;
}

/** Decodes image bytes; resolves undefined when this environment cannot decode them. */
export type ImageDecoder = (bytes: Uint8Array, mediaType: string) => Promise<DecodedImage | undefined>;

/** The worker's decoder: `createImageBitmap` + `OffscreenCanvas`, when the WebView has them. */
export const canvasImageDecoder: ImageDecoder = async (bytes, mediaType) => {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return undefined;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mediaType }));
  } catch {
    return undefined;
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    async encode(width, height, mimeType) {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image canvas is unavailable");
      if (mimeType === "image/jpeg") {
        // JPEG has no alpha: flatten transparency onto white rather than black.
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvas.convertToBlob({ type: mimeType, quality: 0.85 });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || mimeType };
    },
    close: () => bitmap.close(),
  };
};

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Scale factor that fits `width`×`height` within the side and pixel budgets. */
export function modelImageScale(width: number, height: number): number {
  return Math.min(1, MODEL_IMAGE_MAX_SIDE / Math.max(width, height), Math.sqrt(MODEL_IMAGE_MAX_PIXELS / (width * height)));
}

/**
 * Fit a Book image to what vision models accept: within the size budgets and
 * in a provider-safe format. An image that already fits is passed through
 * byte-for-byte; anything else is decoded, downscaled and re-encoded (JPEG
 * stays JPEG, everything else becomes PNG to keep transparency).
 */
export async function prepareModelImage(
  src: string,
  bytes: Uint8Array,
  mediaType: string,
  decode: ImageDecoder = canvasImageDecoder,
): Promise<ModelImage> {
  const passable = MODEL_MIME_TYPES.has(mediaType) && bytes.length <= MODEL_IMAGE_MAX_BYTES;
  const decoded = await decode(bytes, mediaType);
  if (!decoded) {
    if (passable) return { src, mimeType: mediaType, data: base64(bytes) };
    throw new Error(`Cannot convert the ${mediaType || "unknown"} image ${src} for the model`);
  }
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error(`Image ${src} is empty`);
    const scale = modelImageScale(width, height);
    if (passable && scale === 1) return { src, mimeType: mediaType, data: base64(bytes), width, height };
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const encoded = await decoded.encode(targetWidth, targetHeight, mediaType === "image/jpeg" ? "image/jpeg" : "image/png");
    if (!MODEL_MIME_TYPES.has(encoded.mimeType)) throw new Error(`Cannot convert the ${mediaType} image ${src} for the model`);
    return { src, mimeType: encoded.mimeType, data: base64(encoded.bytes), width: targetWidth, height: targetHeight };
  } finally {
    decoded.close();
  }
}
