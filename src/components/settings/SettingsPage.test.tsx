// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import type { ReaderStyleState } from "@/lib/reader-styles";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: {
      configured: true,
      provider: "openai",
      model: "gpt-4",
      hasApiKey: true,
      customProviders: [],
    },
    load: vi.fn(),
    save: vi.fn(),
    addCustomProvider: vi.fn(),
    updateCustomProvider: vi.fn(),
    deleteCustomProvider: vi.fn(),
    switchProvider: vi.fn(),
    loading: false,
    saving: false,
    error: null,
  }),
}));

const styleState: ReaderStyleState = {
  fontSize: 16,
  fontFamily: "serif",
  theme: "light",
  lineHeight: 1.7,
  contentWidth: 42,
  pagePadding: 1.75,
  textAlign: "start",
  letterSpacing: 0,
  paragraphSpacing: 1,
  firstLineIndent: 0,
};

const noop = () => {};

afterEach(() => {
  cleanup();
});

describe("SettingsPage", () => {
  it("switches left-nav sections and enables fonts without a book", () => {
    const { getByRole, getByText, queryByText } = render(
      <SettingsPage
        onBack={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(getByText("正在编辑默认排版")).toBeTruthy();
    expect(getByRole("slider", { name: "字体大小" })).toBeTruthy();
    expect(getByText("16px")).toBeTruthy();
    expect(getByRole("button", { name: "衬线" })).toHaveProperty("disabled", false);
    expect(queryByText("打开书籍后生效")).toBeNull();
    expect(queryByText("恢复默认")).toBeNull();

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    expect(getByRole("button", { name: "白天" })).toBeTruthy();
    expect(queryByText("字体大小")).toBeNull();

    act(() => {
      getByRole("button", { name: "AI" }).click();
    });
    expect(getByText("Provider")).toBeTruthy();
  });

  it("shows book copy and restore-default only for overridden keys", () => {
    const onRestore = vi.fn();
    const { getByText, queryByText, getAllByText } = render(
      <SettingsPage
        onBack={noop}
        bookTitle="测试书"
        hasBook={true}
        styleState={{ ...styleState, lineHeight: 1.4 }}
        onTypographyChange={noop}
        onRestoreDefault={onRestore}
        overriddenKeys={["lineHeight"]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(getByText("正在编辑《测试书》的排版")).toBeTruthy();
    expect(getByText("恢复默认")).toBeTruthy();
    expect(queryByText("打开书籍后生效")).toBeNull();
    getAllByText("恢复默认")[0].click();
    expect(onRestore).toHaveBeenCalledWith("lineHeight");
  });

  it("uses book copy when hasBook is true even without a title", () => {
    const { getByText } = render(
      <SettingsPage
        onBack={noop}
        bookTitle={null}
        hasBook={true}
        styleState={styleState}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(getByText("正在编辑《这本书》的排版")).toBeTruthy();
  });

  it("exposes a slider and current value for a continuous field", () => {
    const onChange = vi.fn();
    const { getByRole, getByText } = render(
      <SettingsPage
        onBack={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, firstLineIndent: 1.2 }}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(getByText("1.2em")).toBeTruthy();
    expect(getByRole("slider", { name: "首行缩进" }).getAttribute("aria-valuenow")).toBe("1.2");
  });
});
