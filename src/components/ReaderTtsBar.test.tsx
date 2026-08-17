// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ReaderTtsBar } from "./ReaderTtsBar";

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  vi.unstubAllGlobals();
});

const voices = [{ voiceURI: "mock://en", name: "Mock English", lang: "en-US" }];

describe("ReaderTtsBar", () => {
  it("exposes pause, stop, rate, and voice controls", () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    const onRate = vi.fn();
    const onVoice = vi.fn();
    const { getByLabelText, getByTestId, getByText } = render(
      <ReaderTtsBar
        playing
        rate={1}
        voiceURI="mock://en"
        voices={voices}
        onPause={onPause}
        onStop={onStop}
        onRate={onRate}
        onVoice={onVoice}
      />,
    );
    const bar = getByTestId("reader-tts-bar");
    expect(bar.className).not.toMatch(/shadow-(sm|md|lg)/);
    fireEvent.click(getByLabelText("暂停"));
    fireEvent.click(getByLabelText("停止"));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(getByLabelText("语速")).toBeTruthy();
    expect(getByLabelText("声音")).toBeTruthy();
    expect(getByText("1.0")).toBeTruthy();
  });

  it("uses English aria-labels when the locale is en", () => {
    setLocale("en");
    const { getByLabelText } = render(
      <ReaderTtsBar
        playing
        rate={1.2}
        voiceURI="mock://en"
        voices={voices}
        onPause={vi.fn()}
        onStop={vi.fn()}
        onRate={vi.fn()}
        onVoice={vi.fn()}
      />,
    );
    expect(getByLabelText("Pause")).toBeTruthy();
    expect(getByLabelText("Stop")).toBeTruthy();
    expect(getByLabelText("Speed")).toBeTruthy();
    expect(getByLabelText("Voice")).toBeTruthy();
  });

  it("shows play on the first button when paused", () => {
    const onPlay = vi.fn();
    const { getByLabelText } = render(
      <ReaderTtsBar
        playing={false}
        rate={1}
        voiceURI="mock://en"
        voices={voices}
        onPause={vi.fn()}
        onPlay={onPlay}
        onStop={vi.fn()}
        onRate={vi.fn()}
        onVoice={vi.fn()}
      />,
    );
    fireEvent.click(getByLabelText("朗读"));
    expect(onPlay).toHaveBeenCalledOnce();
  });
});
