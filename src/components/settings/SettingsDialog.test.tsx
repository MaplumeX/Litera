// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import type { ReaderStyleState } from "@/lib/reader-styles";
import { setLocale } from "@/lib/i18n";
import { DEFAULT_READER_MODE_KEY } from "@/lib/reader-mode";
import {
  DEFAULT_UI_FONT_FAMILY,
  UI_FONT_FAMILY_KEY,
  UI_FONT_SIZE_KEY,
  applyUiChrome,
  chromeFontStack,
} from "@/lib/ui-chrome-font";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const getVersionMock = vi.fn(() => Promise.resolve("0.2.0"));
const openUrlMock = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => getVersionMock(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrlMock(url),
}));

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
    listRemoteModels: vi.fn(),
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
  columnCount: 2,
  overrideFont: false,
  overrideLayout: false,
};

const noop = () => {};

invokeMock.mockImplementation((cmd: string) => {
  if (cmd === "list_system_fonts") {
    return Promise.resolve(["Noto Sans CJK SC", "Source Han Serif"]);
  }
  return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
});

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  localStorage.removeItem(DEFAULT_READER_MODE_KEY);
  localStorage.removeItem(UI_FONT_SIZE_KEY);
  localStorage.removeItem(UI_FONT_FAMILY_KEY);
  document.documentElement.style.fontSize = "";
  document.documentElement.style.removeProperty("--font-sans");
  invokeMock.mockClear();
  getVersionMock.mockReset();
  getVersionMock.mockImplementation(() => Promise.resolve("0.2.0"));
  openUrlMock.mockReset();
  openUrlMock.mockImplementation(() => Promise.resolve());
});

describe("SettingsDialog", () => {
  it("renders a dialog when open and closes via the Dialog control", () => {
    const onClose = vi.fn();
    const { getByRole, queryByRole, rerender } = render(
      <SettingsDialog
        open
        onClose={onClose}
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

    expect(getByRole("dialog")).toBeTruthy();
    act(() => {
      getByRole("button", { name: "Close" }).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsDialog
        open={false}
        onClose={onClose}
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
    expect(queryByRole("dialog")).toBeNull();
  });

  it("locks the dialog shell to a fixed size", () => {
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    const dialog = getByRole("dialog");
    expect(dialog.className).toContain("w-[768px]");
    expect(dialog.className).toContain("h-[40rem]");
    expect(dialog.className).toContain("max-h-[85vh]");
    expect(dialog.className).toContain("sm:max-w-[calc(100%-2rem)]");
    expect(dialog.className).not.toContain("sm:max-w-3xl");
    expect(dialog.className).not.toContain("sm:max-w-lg");
  });

  it("keeps the typography preview visible after focusing a lower control", () => {
    const { getByText, getByRole, queryByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(getByText("预览")).toBeTruthy();
    const previewEl = document.body.querySelector(".litera-typography-preview");
    expect(previewEl).not.toBeNull();
    expect(previewEl!.querySelectorAll("p").length).toBe(2);
    const styleEl = document.body.querySelector("style");
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain(".litera-typography-preview");
    expect(styleEl!.textContent).toContain("font-size: 16px");
    expect(queryByRole("slider")).toBeNull();

    const previewCol = previewEl!.closest(".overflow-y-auto") as HTMLElement;
    const split = previewCol.parentElement as HTMLElement;
    expect(split.className).toContain("flex-row");
    expect(split.className).toContain("@max-[519px]:flex-col-reverse");
    const inspector = split.children[0] as HTMLElement;
    expect(inspector.className).toContain("w-64");
    expect(inspector.className).toContain("overflow-y-auto");
    expect(previewCol.className).toContain("flex-1");
    expect(previewCol.className).toContain("overflow-y-auto");
    expect(
      inspector.compareDocumentPosition(previewCol) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const indent = getByRole("textbox", { name: "首行缩进" });
    act(() => {
      indent.focus();
      fireEvent.change(indent, { target: { value: "1" } });
    });
    expect(document.body.querySelector(".litera-typography-preview")).not.toBeNull();
    expect(getByText("预览")).toBeTruthy();
  });

  it("renders independent override font and layout segmented controls", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const fontGroup = getByRole("radiogroup", { name: "覆盖字体" });
    const layoutGroup = getByRole("radiogroup", { name: "覆盖排版" });
    expect(fontGroup.className).not.toContain("w-full");
    expect(layoutGroup.className).not.toContain("w-full");
    expect(within(fontGroup).getByRole("radio", { name: "关" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(within(fontGroup).getByRole("radio", { name: "开" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(within(layoutGroup).getByRole("radio", { name: "关" }).getAttribute("aria-checked")).toBe(
      "true",
    );

    act(() => {
      within(fontGroup).getByRole("radio", { name: "开" }).click();
    });
    expect(onChange).toHaveBeenCalledWith("overrideFont", true);
    expect(onChange).not.toHaveBeenCalledWith("overrideLayout", expect.anything());

    onChange.mockClear();
    act(() => {
      within(layoutGroup).getByRole("radio", { name: "开" }).click();
    });
    expect(onChange).toHaveBeenCalledWith("overrideLayout", true);
    expect(onChange).not.toHaveBeenCalledWith("overrideFont", expect.anything());

    onChange.mockClear();
    act(() => {
      within(fontGroup).getByRole("radio", { name: "关" }).click();
    });
    expect(onChange).toHaveBeenCalledWith("overrideFont", false);
    expect(onChange).not.toHaveBeenCalledWith("overrideLayout", expect.anything());
  });

  it("shows restore-default on override rows when those keys are overridden", () => {
    const onRestore = vi.fn();
    const { getByText } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle="测试书"
        hasBook={true}
        styleState={{ ...styleState, overrideFont: false }}
        onTypographyChange={noop}
        onRestoreDefault={onRestore}
        overriddenKeys={["overrideFont"]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const fontLabel = getByText("覆盖字体");
    act(() => {
      within(fontLabel.parentElement as HTMLElement).getByText("恢复默认").click();
    });
    expect(onRestore).toHaveBeenCalledWith("overrideFont");
  });

  it("renders the column count row and reports changes and restore", () => {
    const onChange = vi.fn();
    const onRestore = vi.fn();
    const { getByRole, getByText, queryByText, rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={onRestore}
        overriddenKeys={["columnCount"]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const group = getByRole("radiogroup", { name: "分栏数" });
    expect(group.className).not.toContain("w-full");
    expect(within(group).getByRole("radio", { name: "2" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(within(group).getByRole("radio", { name: "1" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(getByText("恢复默认")).toBeTruthy();

    act(() => {
      within(group).getByRole("radio", { name: "3" }).click();
    });
    expect(onChange).toHaveBeenCalledWith("columnCount", 3);
    expect(onChange).not.toHaveBeenCalledWith("textAlign", expect.anything());

    act(() => {
      getByText("恢复默认").click();
    });
    expect(onRestore).toHaveBeenCalledWith("columnCount");

    onChange.mockClear();
    onRestore.mockClear();
    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, columnCount: 2 }}
        onTypographyChange={onChange}
        onRestoreDefault={onRestore}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(
      within(getByRole("radiogroup", { name: "分栏数" }))
        .getByRole("radio", { name: "2" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(queryByText("恢复默认")).toBeNull();
  });

  it("updates the preview CSS when fontSize changes", () => {
    const { rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    let styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("font-size: 16px");

    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, fontSize: 22 }}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("font-size: 22px");
    expect(styleEl!.textContent).not.toContain("font-size: 16px");
  });

  it("updates the preview CSS when fontFamily changes", () => {
    const { rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    let styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("font-family: serif;");

    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, fontFamily: "monospace" }}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("font-family: monospace;");
  });

  it("updates the preview CSS when textAlign changes", () => {
    const { rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    let styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("text-align: start");

    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, textAlign: "justify" }}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("text-align: justify");
  });

  it("updates the preview CSS when lineHeight changes", () => {
    const { rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    let styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("line-height: 1.7");

    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, lineHeight: 2 }}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    styleEl = document.body.querySelector("style");
    expect(styleEl!.textContent).toContain("line-height: 2");
    expect(styleEl!.textContent).not.toContain("line-height: 1.7");
  });

  it("hides the preview when switching to the appearance section", () => {
    const { getByRole, queryByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(queryByText("预览")).not.toBeNull();
    expect(document.body.querySelector(".litera-typography-preview")).not.toBeNull();

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });

    expect(queryByText("预览")).toBeNull();
    expect(document.body.querySelector(".litera-typography-preview")).toBeNull();
  });

  it("shows English example text in the preview when locale is en", () => {
    setLocale("en");
    const { getByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(getByText("Preview")).toBeTruthy();
    const previewEl = document.body.querySelector(".litera-typography-preview");
    expect(previewEl).not.toBeNull();
    expect(previewEl!.textContent).toContain("morning mist");
    expect(previewEl!.textContent).not.toContain("清晨");
  });

  it("switches left-nav sections and enables fonts without a book", () => {
    const { getByRole, getByText, queryByText, queryByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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
    expect(getByRole("textbox", { name: "字体大小" })).toHaveProperty("value", "16");
    expect(getByRole("button", { name: "减小字体大小" })).toBeTruthy();
    expect(getByRole("button", { name: "增大字体大小" })).toBeTruthy();
    expect(queryByRole("slider")).toBeNull();
    expect(getByRole("combobox")).toHaveProperty("disabled", false);
    expect(getByText("衬线")).toBeTruthy();
    expect(queryByText("打开书籍后生效")).toBeNull();
    expect(queryByText("恢复默认")).toBeNull();

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    expect(getByRole("radio", { name: "白天" })).toBeTruthy();
    expect(getByRole("slider", { name: "界面字号" })).toBeTruthy();
    expect(queryByText("字体大小")).toBeNull();

    act(() => {
      getByRole("button", { name: "AI" }).click();
    });
    expect(getByText("当前使用")).toBeTruthy();
  });

  it("shows book copy and restore-default only for overridden keys", () => {
    const onRestore = vi.fn();
    const { getByText, queryByText, getAllByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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
      <SettingsDialog
        open
        onClose={noop}
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

  it("exposes stepper buttons and an editable value for a continuous field", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(getByRole("textbox", { name: "首行缩进" })).toHaveProperty("value", "1.2");
    expect(getByRole("button", { name: "减小首行缩进" })).toBeTruthy();
    expect(getByRole("button", { name: "增大首行缩进" })).toBeTruthy();
  });

  it("steps font size with plus and does not go below the minimum", () => {
    const onChange = vi.fn();
    const { getByRole, rerender } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    act(() => {
      getByRole("button", { name: "增大字体大小" }).click();
    });
    expect(onChange).toHaveBeenCalledWith("fontSize", 17);

    onChange.mockClear();
    rerender(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, fontSize: 12 }}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const decrease = getByRole("button", { name: "减小字体大小" });
    expect(decrease).toHaveProperty("disabled", true);
    act(() => {
      decrease.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reverts invalid typed values and clamps out-of-range input", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const input = getByRole("textbox", { name: "字体大小" }) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "abc" } });
      fireEvent.blur(input);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("16");

    act(() => {
      fireEvent.change(input, { target: { value: "999" } });
      fireEvent.blur(input);
    });
    expect(onChange).toHaveBeenCalledWith("fontSize", 32);
  });

  it("commits a typed value on Enter and reverts on Escape without closing", () => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={onClose}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    const input = getByRole("textbox", { name: "字体大小" }) as HTMLInputElement;
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "20" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onChange).toHaveBeenCalledWith("fontSize", 20);

    onChange.mockClear();
    act(() => {
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "22" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("16");
    expect(onClose).not.toHaveBeenCalled();
    expect(getByRole("dialog")).toBeTruthy();
  });

  it("switches visible copy to English from the appearance language row", () => {
    const { getByRole, getByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    act(() => {
      getByRole("radio", { name: "English" }).click();
    });

    expect(getByText("Language")).toBeTruthy();
    expect(getByRole("button", { name: "Appearance" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("exposes exclusive choice rows as radiogroups with the current value checked", () => {
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(getByRole("radiogroup", { name: "对齐" })).toBeTruthy();
    expect(getByRole("radiogroup", { name: "对齐" }).className).not.toContain("w-full");
    expect(getByRole("radio", { name: "左齐" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "两端" }).getAttribute("aria-checked")).toBe("false");

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });

    expect(getByRole("radiogroup", { name: "主题" })).toBeTruthy();
    expect(getByRole("radiogroup", { name: "语言" })).toBeTruthy();
    expect(getByRole("radiogroup", { name: "默认阅读模式" })).toBeTruthy();
    expect(getByRole("radio", { name: "白天" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "夜间" }).getAttribute("aria-checked")).toBe("false");
    expect(getByRole("radio", { name: "中文" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "English" }).getAttribute("aria-checked")).toBe("false");
  });

  it("does not list Geist in the typography font picker", async () => {
    const { getByRole, queryByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("combobox").click();
    });
    await waitFor(() => getByRole("option", { name: "衬线" }));
    expect(queryByRole("option", { name: "Geist" })).toBeNull();
  });

  it("opens a searchable font combobox with generics at the top", async () => {
    const { getByRole, getByPlaceholderText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("combobox").click();
    });

    expect(getByPlaceholderText("搜索字体…")).toBeTruthy();
    const serif = await waitFor(() => getByRole("option", { name: "衬线" }));
    const named = await waitFor(() => getByRole("option", { name: "Noto Sans CJK SC" }));
    expect(getByRole("option", { name: "无衬线" })).toBeTruthy();
    expect(getByRole("option", { name: "等宽" })).toBeTruthy();
    expect(
      serif.compareDocumentPosition(named) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("choosing a named font calls onTypographyChange", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    act(() => {
      getByRole("combobox").click();
    });
    const option = await waitFor(() => getByRole("option", { name: /Noto Sans CJK SC/ }));
    act(() => {
      option.click();
    });
    expect(onChange).toHaveBeenCalledWith("fontFamily", "Noto Sans CJK SC");
  });

  it("keeps a missing saved font selected and marks it unavailable", async () => {
    const { getByRole, findByText } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={{ ...styleState, fontFamily: "MissingFont" }}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(await findByText("不可用")).toBeTruthy();
    expect(getByRole("combobox").textContent).toContain("MissingFont");
  });

  it("shows chrome font and size under appearance and applies them live", async () => {
    const onTypographyChange = vi.fn();
    const { getByRole, getByText } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onTypographyChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });

    expect(getByText("界面字体")).toBeTruthy();
    expect(getByText("界面字号")).toBeTruthy();
    expect(getByRole("combobox").textContent).toContain("Geist");
    const sizeSlider = getByRole("slider", { name: "界面字号" });
    expect(sizeSlider.getAttribute("aria-valuenow")).toBe("16");
    expect(sizeSlider.getAttribute("aria-valuemin")).toBe("12");
    expect(sizeSlider.getAttribute("aria-valuemax")).toBe("20");
    expect(getByText("16px")).toBeTruthy();

    act(() => {
      getByRole("combobox").click();
    });
    const geist = await waitFor(() => getByRole("option", { name: "Geist" }));
    const serif = getByRole("option", { name: "衬线" });
    const named = await waitFor(() => getByRole("option", { name: "Noto Sans CJK SC" }));
    expect(
      geist.compareDocumentPosition(serif) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      serif.compareDocumentPosition(named) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      named.click();
    });
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(
      chromeFontStack("Noto Sans CJK SC"),
    );
    expect(localStorage.getItem(UI_FONT_FAMILY_KEY)).toBe("Noto Sans CJK SC");
    expect(onTypographyChange).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.some((call) => call[0] === "save_preferences")).toBe(false);

    act(() => {
      fireEvent.keyDown(sizeSlider, { key: "ArrowRight" });
    });
    expect(document.documentElement.style.fontSize).toBe("17px");
    expect(localStorage.getItem(UI_FONT_SIZE_KEY)).toBe("17");
    expect(getByText("17px")).toBeTruthy();
  });

  it("does not apply chrome when the typography font changes", async () => {
    applyUiChrome(16, DEFAULT_UI_FONT_FAMILY);
    const before = document.documentElement.style.getPropertyValue("--font-sans");
    const onChange = vi.fn();
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle={null}
        hasBook={false}
        styleState={styleState}
        onTypographyChange={onChange}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    act(() => {
      getByRole("combobox").click();
    });
    const option = await waitFor(() => getByRole("option", { name: /Noto Sans CJK SC/ }));
    act(() => {
      option.click();
    });
    expect(onChange).toHaveBeenCalledWith("fontFamily", "Noto Sans CJK SC");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe(before);
    expect(localStorage.getItem(UI_FONT_FAMILY_KEY)).toBeNull();
  });

  it("keeps a missing chrome font selected and does not rewrite storage", async () => {
    localStorage.setItem(UI_FONT_FAMILY_KEY, "MissingChromeFont");
    const { getByRole, findByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    expect(await findByText("不可用")).toBeTruthy();
    expect(getByRole("combobox").textContent).toContain("MissingChromeFont");
    expect(localStorage.getItem(UI_FONT_FAMILY_KEY)).toBe("MissingChromeFont");
  });

  it("filters chrome system fonts from the shared search box", async () => {
    const { getByRole, getByPlaceholderText, findByRole, queryByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    act(() => {
      getByRole("combobox").click();
    });
    await waitFor(() => getByRole("option", { name: "Noto Sans CJK SC" }));
    fireEvent.change(getByPlaceholderText("搜索字体…"), { target: { value: "Noto" } });
    expect(await findByRole("option", { name: "Noto Sans CJK SC" })).toBeTruthy();
    expect(queryByRole("option", { name: "衬线" })).toBeNull();
  });

  it("persists the default reader mode to localStorage only", () => {
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("button", { name: "外观" }).click();
    });
    expect(getByRole("radio", { name: "阅读" }).getAttribute("aria-checked")).toBe("true");
    act(() => {
      getByRole("radio", { name: "Agent" }).click();
    });
    expect(localStorage.getItem(DEFAULT_READER_MODE_KEY)).toBe("agent");
    expect(getByRole("radio", { name: "Agent" }).getAttribute("aria-checked")).toBe("true");
    expect(invokeMock.mock.calls.some((call) => call[0] === "save_preferences")).toBe(false);
    expect(invokeMock.mock.calls.some((call) => call[0] === "update_reading_state")).toBe(false);
  });

  it("opens the about section without typography, appearance, or AI controls", async () => {
    const { getByRole, getByText, queryByRole, queryByText, findByText } = render(
      <SettingsDialog
        open
        onClose={noop}
        bookTitle="测试书"
        hasBook={true}
        styleState={styleState}
        onTypographyChange={noop}
        onRestoreDefault={noop}
        overriddenKeys={[]}
        theme="light"
        onThemeChange={noop}
      />,
    );

    expect(getByRole("button", { name: "关于" })).toBeTruthy();
    expect(getByText("正在编辑《测试书》的排版")).toBeTruthy();

    act(() => {
      getByRole("button", { name: "关于" }).click();
    });

    expect(getByText("Litera")).toBeTruthy();
    expect(getByText("版本信息与项目链接")).toBeTruthy();
    expect(await findByText("0.2.0")).toBeTruthy();
    expect(queryByRole("slider", { name: "字体大小" })).toBeNull();
    expect(queryByRole("radio", { name: "白天" })).toBeNull();
    expect(queryByText("当前使用")).toBeNull();
    expect(queryByText("正在编辑默认排版")).toBeNull();
    expect(queryByText("正在编辑《测试书》的排版")).toBeNull();
  });

  it("shows the runtime version and opens GitHub URLs from about", async () => {
    const { getByRole, findByText } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    act(() => {
      getByRole("button", { name: "关于" }).click();
    });

    expect(await findByText("0.2.0")).toBeTruthy();
    expect(getByRole("button", { name: "源码仓库" })).toBeTruthy();
    expect(getByRole("button", { name: "发行版本" })).toBeTruthy();

    act(() => {
      getByRole("button", { name: "源码仓库" }).click();
    });
    expect(openUrlMock).toHaveBeenCalledWith("https://github.com/MaplumeX/Litera");

    act(() => {
      getByRole("button", { name: "发行版本" }).click();
    });
    expect(openUrlMock).toHaveBeenCalledWith("https://github.com/MaplumeX/Litera/releases");
  });

  it("shows a version placeholder when getVersion fails and keeps links usable", async () => {
    getVersionMock.mockRejectedValue(new Error("no version"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { getByRole, getByText, queryByText } = render(
        <SettingsDialog
          open
          onClose={noop}
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

      act(() => {
        getByRole("button", { name: "关于" }).click();
      });

      await waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
      expect(getByText("—")).toBeTruthy();
      expect(queryByText("0.2.0")).toBeNull();
      act(() => {
        getByRole("button", { name: "源码仓库" }).click();
      });
      expect(openUrlMock).toHaveBeenCalledWith("https://github.com/MaplumeX/Litera");
    } finally {
      error.mockRestore();
    }
  });

  it("keeps the about section open when opening a link fails", async () => {
    openUrlMock.mockRejectedValue(new Error("no browser"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { getByRole, getByText, findByText } = render(
        <SettingsDialog
          open
          onClose={noop}
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

      act(() => {
        getByRole("button", { name: "关于" }).click();
      });
      expect(await findByText("0.2.0")).toBeTruthy();

      act(() => {
        getByRole("button", { name: "源码仓库" }).click();
      });
      await waitFor(() => {
        expect(error).toHaveBeenCalled();
      });
      expect(getByRole("dialog")).toBeTruthy();
      expect(getByText("Litera")).toBeTruthy();
      expect(getByRole("button", { name: "源码仓库" })).toBeTruthy();
    } finally {
      error.mockRestore();
    }
  });

  it("labels the about nav as About in English", () => {
    setLocale("en");
    const { getByRole } = render(
      <SettingsDialog
        open
        onClose={noop}
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

    expect(getByRole("button", { name: "About" })).toBeTruthy();
  });
});
