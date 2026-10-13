import { describe, expect, it } from "vitest";
import { shortBookTitle } from "./book-title";

describe("shortBookTitle", () => {
  it("drops a bracketed note or subtitle", () => {
    expect(
      shortBookTitle("置身事内 中国政府与经济发展【复旦经院“毕业课”解读】罗来浩"),
    ).toBe("置身事内 中国政府与经济发展");
    expect(shortBookTitle("资本论(1-3)")).toBe("资本论");
    expect(shortBookTitle("微观经济学：现代观点（第九版）")).toBe("微观经济学");
    expect(shortBookTitle("Capital: A Critique")).toBe("Capital");
  });

  it("keeps titles with nothing to drop, or nothing left after dropping", () => {
    expect(shortBookTitle("  怎么办?  ")).toBe("怎么办?");
    expect(shortBookTitle("【精装】小逻辑")).toBe("【精装】小逻辑");
    expect(shortBookTitle("X: The Book")).toBe("X: The Book");
  });
});
