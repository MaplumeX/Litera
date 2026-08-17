// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as readerTts from "./reader-tts";
import { TTS_RATE_KEY, TTS_VOICE_KEY } from "./reader-tts";
import { useReaderTts, type ReaderTtsHandle } from "./use-reader-tts";

class MockUtterance {
  text = "";
  rate = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: ((ev: Event) => void) | null = null;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(text?: string) {
    this.text = text ?? "";
  }
}

const voices = [
  {
    voiceURI: "mock://en",
    name: "Mock English",
    lang: "en-US",
    localService: true,
    default: true,
  },
] as SpeechSynthesisVoice[];

const pending: MockUtterance[] = [];

function installSpeech(list: SpeechSynthesisVoice[] = voices) {
  pending.length = 0;
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => list,
    speak(utterance: MockUtterance) {
      pending.push(utterance);
      queueMicrotask(() => utterance.onstart?.(new Event("start")));
    },
    cancel() {
      const current = pending.splice(0);
      for (const utterance of current) {
        utterance.onerror?.(
          Object.assign(new Event("error"), { error: "canceled" }) as SpeechSynthesisErrorEvent,
        );
      }
    },
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
  return synth;
}

function finishCurrent() {
  const utterance = pending.shift();
  utterance?.onend?.(new Event("end"));
}

function createHandle(overrides: Partial<ReaderTtsHandle> = {}): ReaderTtsHandle {
  return {
    initTts: vi.fn(async () => true),
    ttsSpeakOrigin: vi.fn(() => '<speak><mark name="0"/>Hello.</speak>'),
    ttsNext: vi.fn(() => undefined),
    ttsResume: vi.fn(() => '<speak><mark name="0"/>Hello.</speak>'),
    ttsSetMark: vi.fn(),
    clearTtsHighlight: vi.fn(),
    advanceTtsSection: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  localStorage.removeItem(TTS_RATE_KEY);
  localStorage.removeItem(TTS_VOICE_KEY);
  pending.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useReaderTts", () => {
  beforeEach(() => {
    installSpeech();
  });

  it("plays one utterance per mark and highlights on start", async () => {
    const handle = createHandle({
      ttsSpeakOrigin: vi.fn(
        () =>
          '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="0"/>Hello.<mark name="1"/>World.</speak>',
      ),
    });
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    await waitFor(() => expect(handle.ttsSetMark).toHaveBeenCalledWith("0"));
    expect(pending[0]?.text).toBe("Hello.");
    await act(async () => {
      finishCurrent();
    });
    await waitFor(() => expect(handle.ttsSetMark).toHaveBeenCalledWith("1"));
    expect(pending[0]?.text).toBe("World.");
  });

  it("pauses by canceling and resumes leftover marks", async () => {
    const handle = createHandle({
      ttsSpeakOrigin: vi.fn(
        () =>
          '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="0"/>Hello.<mark name="1"/>World.</speak>',
      ),
    });
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => {
      result.current.pause();
    });
    expect(result.current.status).toBe("paused");
    expect(pending.length).toBe(0);
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(pending[0]?.text).toBe("Hello.");
  });

  it("stops, clears the highlight, and hides playback", async () => {
    const handle = createHandle();
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe("idle");
    expect(handle.clearTtsHighlight).toHaveBeenCalled();
  });

  it("stays idle and reports when no voices are available", async () => {
    installSpeech([]);
    vi.spyOn(readerTts, "waitForVoices").mockResolvedValue([]);
    const handle = createHandle();
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.error).toBe("系统没有可用的语音"));
    expect(result.current.status).toBe("idle");
    expect(handle.initTts).not.toHaveBeenCalled();
  });

  it("cancels an in-flight start as idle if pause happens before speech", async () => {
    let resolveVoices!: (list: SpeechSynthesisVoice[]) => void;
    vi.spyOn(readerTts, "waitForVoices").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVoices = resolve;
        }),
    );
    const handle = createHandle();
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    expect(result.current.status).toBe("playing");
    act(() => {
      result.current.pause();
    });
    expect(result.current.status).toBe("idle");
    await act(async () => {
      resolveVoices(voices);
    });
    expect(result.current.status).toBe("idle");
    expect(handle.initTts).not.toHaveBeenCalled();
  });

  it("does not treat canceled errors as failures", async () => {
    const handle = createHandle();
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => {
      result.current.pause();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("paused");
  });

  it("restarts from the visible range on user relocate", async () => {
    const handle = createHandle({
      ttsSpeakOrigin: vi.fn((source?: "auto" | "visible") =>
        source === "visible"
          ? '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="2"/>Later.</speak>'
          : '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="0"/>Hello.</speak>',
      ),
    });
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    await act(async () => {
      result.current.onUserRelocate();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handle.ttsSpeakOrigin).toHaveBeenCalledWith("visible");
    expect(pending[0]?.text).toBe("Later.");
  });

  it("advances to the next block then section when marks run out", async () => {
    const handle = createHandle({
      ttsSpeakOrigin: vi.fn(
        () => '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="0"/>Hello.</speak>',
      ),
      ttsNext: vi.fn(() => undefined),
      advanceTtsSection: vi.fn(
        async () =>
          '<speak xmlns="http://www.w3.org/2001/10/synthesis"><mark name="0"/>Next chapter.</speak>',
      ),
    });
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      finishCurrent();
    });
    await waitFor(() => expect(handle.advanceTtsSection).toHaveBeenCalled());
    await waitFor(() => expect(pending[0]?.text).toBe("Next chapter."));
  });

  it("stops at book end", async () => {
    const handle = createHandle({
      ttsNext: vi.fn(() => undefined),
      advanceTtsSection: vi.fn(async () => undefined),
    });
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => {
      finishCurrent();
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(handle.clearTtsHighlight).toHaveBeenCalled();
  });

  it("stops when the book is hidden or the file changes", async () => {
    const handle = createHandle();
    const { result, rerender, unmount } = renderHook(
      (props: { bookHidden: boolean; fileKey: string | null }) =>
        useReaderTts({
          readerRef: { current: handle },
          bookHidden: props.bookHidden,
          fileKey: props.fileKey,
        }),
      { initialProps: { bookHidden: false, fileKey: "book-1" } },
    );
    await act(async () => {
      result.current.play();
    });
    await waitFor(() => expect(result.current.status).toBe("playing"));
    rerender({ bookHidden: true, fileKey: "book-1" });
    expect(result.current.status).toBe("idle");
    await act(async () => {
      result.current.play();
    });
    rerender({ bookHidden: false, fileKey: "book-2" });
    expect(handle.clearTtsHighlight).toHaveBeenCalled();
    unmount();
    expect(handle.clearTtsHighlight).toHaveBeenCalled();
  });

  it("persists rate and voice", () => {
    const handle = createHandle();
    const { result } = renderHook(() =>
      useReaderTts({
        readerRef: { current: handle },
        bookHidden: false,
        fileKey: "book-1",
      }),
    );
    act(() => {
      result.current.setRate(1.4);
      result.current.setVoice("mock://en");
    });
    expect(localStorage.getItem(TTS_RATE_KEY)).toBe("1.4");
    expect(localStorage.getItem(TTS_VOICE_KEY)).toBe("mock://en");
  });
});
