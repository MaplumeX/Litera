// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderFooter } from "./ReaderFooter";
import { ReaderFooterSettingsForm } from "./settings/ReaderFooterSettingsForm";
import { DEFAULT_READER_FOOTER, READER_FOOTER_KEY, saveReaderFooter } from "@/lib/reader-footer";
import { setLocale } from "@/lib/i18n";

const { getBatteryStatus, unlisten, invoke, notifySyncActivity, lifecycle } = vi.hoisted(() => ({
  getBatteryStatus: vi.fn(async () => ({ level: 0.76, charging: true })),
  unlisten: vi.fn(),
  invoke: vi.fn(),
  notifySyncActivity: vi.fn(),
  lifecycle: { handler: null as ((payload: { state: string }) => void) | null },
}));

vi.mock("@/lib/platform-bridge", () => ({
  platformBridge: {
    getBatteryStatus,
    listen: (_event: string, handler: (payload: { state: string }) => void) => {
      lifecycle.handler = handler;
      return Object.assign(unlisten, { ready: Promise.resolve() });
    },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/lib/sync-activity", () => ({ notifySyncActivity }));

beforeEach(() => {
  saveReaderFooter(DEFAULT_READER_FOOTER);
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  saveReaderFooter(DEFAULT_READER_FOOTER);
  localStorage.clear();
  setLocale("zh-CN");
});

describe("ReaderFooter", () => {
  it("shows chapter, chapter progress and book progress in separate positions", () => {
    const { container, getByTitle, getByLabelText } = render(
      <ReaderFooter chapterLabel="第二章" fraction={0.3} ticks={[0, 0.2, 0.6, 1]} />,
    );
    expect(container.querySelector('[data-footer-position="left"]')?.textContent).toBe("第二章");
    expect(getByTitle("本章 25%").textContent).toBe("25%");
    expect(getByLabelText("全书 30%").textContent).toBe("30%");
    expect(getBatteryStatus).not.toHaveBeenCalled();
  });

  it("updates an open reader from settings, persists on this device, and never triggers Sync", async () => {
    const view = render(
      <>
        <ReaderFooterSettingsForm />
        <div data-testid="live-reader"><ReaderFooter chapterLabel="第二章" fraction={0.42} /></div>
      </>,
    );
    fireEvent.keyDown(view.getByRole("combobox", { name: "左侧" }), { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("option", { name: "电量" }));
    const live = within(view.getByTestId("live-reader"));
    expect(await live.findByLabelText("电量 76%，正在充电")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(READER_FOOTER_KEY)!).left).toBe("battery");
    expect(invoke).not.toHaveBeenCalled();
    expect(notifySyncActivity).not.toHaveBeenCalled();
    view.unmount();

    const reopened = render(<ReaderFooter chapterLabel="第二章" fraction={0.42} />);
    expect(await reopened.findByLabelText("电量 76%，正在充电")).toBeTruthy();
    expect(reopened.queryByText("第二章")).toBeNull();
  });

  it("can hide all information while retaining the chosen slots", () => {
    const { getByRole, queryByTestId } = render(
      <><ReaderFooterSettingsForm /><ReaderFooter chapterLabel="第二章" fraction={0.42} /></>,
    );
    fireEvent.click(getByRole("switch", { name: "显示页脚" }));
    expect(queryByTestId("reader-footer")).toBeNull();
    expect((getByRole("combobox", { name: "左侧" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByRole("switch", { name: "显示页脚" }));
    expect(getByRole("combobox", { name: "左侧" }).textContent).toBe("章节名");
  });

  it("supports blank positions and hides the footer when every position is blank", () => {
    saveReaderFooter({ left: "none", center: "none", right: "book-progress" });
    const { container, queryByTestId } = render(<ReaderFooter chapterLabel="第二章" fraction={0.996} />);
    expect(container.textContent).toBe("99%");
    act(() => saveReaderFooter({ right: "none" }));
    expect(queryByTestId("reader-footer")).toBeNull();
  });

  it("refreshes battery after returning to the foreground and stops polling when hidden", async () => {
    saveReaderFooter({ left: "battery" });
    const { getByLabelText } = render(<ReaderFooter chapterLabel="第二章" fraction={0.42} />);
    await waitFor(() => expect(getBatteryStatus).toHaveBeenCalledTimes(1));
    getBatteryStatus.mockResolvedValueOnce({ level: 0.8, charging: false });
    act(() => lifecycle.handler?.({ state: "foreground" }));
    await waitFor(() => expect(getByLabelText("电量 80%")).toBeTruthy());
    vi.useFakeTimers();
    act(() => saveReaderFooter({ enabled: false }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(getBatteryStatus).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("shows an unavailable marker when battery access fails", async () => {
    saveReaderFooter({ right: "battery" });
    getBatteryStatus.mockRejectedValueOnce(new Error("unsupported"));
    const { getByLabelText } = render(<ReaderFooter chapterLabel="第二章" fraction={0.42} />);
    await waitFor(() => expect(getBatteryStatus).toHaveBeenCalledOnce());
    expect(getByLabelText("无法获取电量").textContent).toBe("—");
  });

  it("updates the time at the next minute and localizes the footer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:34:50"));
    saveReaderFooter({ left: "time", center: "none" });
    setLocale("en");
    const { getByRole } = render(<ReaderFooter chapterLabel="Chapter 2" fraction={0.42} />);
    const expected = (date: string) => new Date(date).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
    expect(getByRole("group", { name: "Reading footer" }).textContent).toContain(expected("2026-10-22T12:34:50"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(getByRole("group", { name: "Reading footer" }).textContent).toContain(expected("2026-10-22T12:35:00"));
  });
});
