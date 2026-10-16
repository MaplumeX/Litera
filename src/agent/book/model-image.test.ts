import { describe, expect, it, vi } from "vitest";
import { MODEL_IMAGE_MAX_BYTES, MODEL_IMAGE_MAX_SIDE, base64, modelImageScale, prepareModelImage, type DecodedImage, type ImageDecoder } from "./model-image";

const BYTES = new Uint8Array([1, 2, 3, 4]);

function decoderOf(width: number, height: number, encodedType?: string) {
  const encode = vi.fn<DecodedImage["encode"]>(async (_width, _height, mimeType) => ({ bytes: new Uint8Array([9, 9]), mimeType: encodedType ?? mimeType }));
  const close = vi.fn();
  const decode: ImageDecoder = async () => ({ width, height, encode, close });
  return { decode, encode, close };
}

describe("prepareModelImage", () => {
  it("passes a small image in a provider format through byte-for-byte", async () => {
    const { decode, encode, close } = decoderOf(800, 600);
    await expect(prepareModelImage("a.png", BYTES, "image/png", decode)).resolves.toEqual({ src: "a.png", mimeType: "image/png", data: base64(BYTES), width: 800, height: 600 });
    expect(encode).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("downscales an oversized image and keeps JPEG as JPEG", async () => {
    const { decode, encode } = decoderOf(4000, 3000);
    const image = await prepareModelImage("big.jpg", BYTES, "image/jpeg", decode);
    const [width, height, mimeType] = encode.mock.calls[0];
    expect(Math.max(width, height)).toBeLessThanOrEqual(MODEL_IMAGE_MAX_SIDE);
    expect(width / height).toBeCloseTo(4 / 3, 2);
    expect(mimeType).toBe("image/jpeg");
    expect(image).toMatchObject({ mimeType: "image/jpeg", data: base64(new Uint8Array([9, 9])), width, height });
  });

  it("converts formats providers do not accept to PNG", async () => {
    const { decode, encode } = decoderOf(300, 200);
    await expect(prepareModelImage("a.svg", BYTES, "image/svg+xml", decode)).resolves.toMatchObject({ mimeType: "image/png", width: 300, height: 200 });
    expect(encode).toHaveBeenCalledWith(300, 200, "image/png");
  });

  it("re-encodes a provider-format image that is too many bytes", async () => {
    const { decode, encode } = decoderOf(1000, 1000);
    await prepareModelImage("a.png", new Uint8Array(MODEL_IMAGE_MAX_BYTES + 1), "image/png", decode);
    expect(encode).toHaveBeenCalledWith(1000, 1000, "image/png");
  });

  it("passes through without a decoder only when the bytes are already acceptable", async () => {
    const none: ImageDecoder = async () => undefined;
    await expect(prepareModelImage("a.gif", BYTES, "image/gif", none)).resolves.toEqual({ src: "a.gif", mimeType: "image/gif", data: base64(BYTES) });
    await expect(prepareModelImage("a.svg", BYTES, "image/svg+xml", none)).rejects.toThrow("Cannot convert the image/svg+xml image a.svg");
  });

  it("rejects an encoder that falls back to a format providers do not accept", async () => {
    const { decode } = decoderOf(300, 200, "image/bmp");
    await expect(prepareModelImage("a.bmp", BYTES, "image/bmp", decode)).rejects.toThrow("Cannot convert");
  });
});

describe("modelImageScale", () => {
  it("fits both the side and the pixel budget", () => {
    expect(modelImageScale(800, 600)).toBe(1);
    expect(modelImageScale(3136, 100)).toBe(0.5);
    const scale = modelImageScale(1500, 1500);
    expect(1500 * scale * 1500 * scale).toBeLessThanOrEqual(1_150_000 + 1);
  });
});
