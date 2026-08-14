import { describe, expect, it } from "vitest";
import { detectDesktopOs, usesCustomWindowControls } from "./platform";

describe("detectDesktopOs", () => {
  it("maps macOS user agents to macos", () => {
    expect(
      detectDesktopOs(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("macos");
  });

  it("maps Windows user agents to windows", () => {
    expect(
      detectDesktopOs(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("windows");
  });

  it("maps Linux user agents to linux", () => {
    expect(
      detectDesktopOs(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("linux");
  });

  it("maps unrecognized user agents to unknown", () => {
    expect(detectDesktopOs("Mozilla/5.0")).toBe("unknown");
    expect(detectDesktopOs("")).toBe("unknown");
  });
});

describe("usesCustomWindowControls", () => {
  it("is false only on macOS", () => {
    expect(usesCustomWindowControls("macos")).toBe(false);
    expect(usesCustomWindowControls("windows")).toBe(true);
    expect(usesCustomWindowControls("linux")).toBe(true);
    expect(usesCustomWindowControls("unknown")).toBe(true);
  });
});
