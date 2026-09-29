import { describe, expect, it } from "vitest";
import { formatByteSize } from "./trash";

describe("formatByteSize", () => {
  it("keeps whole units below 1 KiB", () => {
    expect(formatByteSize(0, "en")).toBe("0 B");
    expect(formatByteSize(512, "en")).toBe("512 B");
    expect(formatByteSize(1023, "en")).toBe("1023 B");
  });

  it("steps up through binary units", () => {
    expect(formatByteSize(1024, "en")).toBe("1 KB");
    expect(formatByteSize(1536, "en")).toBe("1.5 KB");
    expect(formatByteSize(1024 * 1024, "en")).toBe("1 MB");
    expect(formatByteSize(1024 ** 3, "en")).toBe("1 GB");
  });

  it("never exceeds the largest unit", () => {
    expect(formatByteSize(1024 ** 5, "en")).toBe("1024 TB");
  });

  it("clamps non-finite and negative input", () => {
    expect(formatByteSize(Number.NaN, "en")).toBe("0 B");
    expect(formatByteSize(Number.POSITIVE_INFINITY, "en")).toBe("0 B");
    expect(formatByteSize(-10, "en")).toBe("0 B");
  });

  it("formats for the active locale", () => {
    // zh-CN groups the same way here; the shared contract is the unit suffix.
    expect(formatByteSize(2048, "zh-CN")).toBe("2 KB");
  });
});
