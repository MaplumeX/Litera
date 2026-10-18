import { describe, expect, it } from "vitest";
import { detectDesktopOs, isAndroid, selectShell, usesCustomWindowControls } from "./platform";

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
    expect(usesCustomWindowControls("macos", false)).toBe(false);
    expect(usesCustomWindowControls("windows", false)).toBe(true);
    expect(usesCustomWindowControls("linux", false)).toBe(true);
    expect(usesCustomWindowControls("unknown", false)).toBe(true);
  });

  it("is false on Android, whose user agent also says Linux", () => {
    expect(usesCustomWindowControls("linux", true)).toBe(false);
  });
});

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

describe("isAndroid", () => {
  it("recognises the Android WebView", () => {
    expect(isAndroid(ANDROID_UA)).toBe(true);
  });

  it("is false on desktop Linux and the other desktops", () => {
    expect(
      isAndroid(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(isAndroid("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isAndroid("")).toBe(false);
  });
});

describe("selectShell", () => {
  it("gives Android phones the mobile shell", () => {
    expect(selectShell({ userAgent: ANDROID_UA, width: 412, height: 915 })).toBe("mobile");
  });

  it("keeps the mobile shell when a phone is rotated to landscape", () => {
    expect(selectShell({ userAgent: ANDROID_UA, width: 915, height: 412 })).toBe("mobile");
  });

  it("gives Android tablets and other wide screens the desktop shell", () => {
    expect(selectShell({ userAgent: ANDROID_UA, width: 800, height: 1280 })).toBe("desktop");
    expect(selectShell({ userAgent: ANDROID_UA, width: 1280, height: 800 })).toBe("desktop");
  });

  it("never gives a desktop the mobile shell, however narrow its window", () => {
    expect(
      selectShell({
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        width: 400,
        height: 500,
      }),
    ).toBe("desktop");
  });
});
