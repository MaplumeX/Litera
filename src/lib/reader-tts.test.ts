// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_RATE,
  loadTtsRate,
  loadTtsVoice,
  parseSsmlMarks,
  parseTtsRate,
  pickDefaultVoice,
  preferredTtsLangs,
  saveTtsRate,
  saveTtsVoice,
  TTS_RATE_KEY,
  TTS_VOICE_KEY,
  waitForVoices,
} from "./reader-tts";

afterEach(() => {
  localStorage.removeItem(TTS_RATE_KEY);
  localStorage.removeItem(TTS_VOICE_KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseSsmlMarks", () => {
  it("extracts plain text after each mark", () => {
    const ssml = `<?xml version="1.0"?>
      <speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en">
        <mark name="0"/>Hello world.
        <mark name="1"/>Second sentence.
      </speak>`;
    expect(parseSsmlMarks(ssml)).toEqual([
      { name: "0", text: "Hello world." },
      { name: "1", text: "Second sentence." },
    ]);
  });

  it("keeps text inside nested markup", () => {
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis">
      <mark name="0"/><emphasis>Hello</emphasis> world.
    </speak>`;
    expect(parseSsmlMarks(ssml)).toEqual([{ name: "0", text: "Hello world." }]);
  });

  it("drops empty and punctuation-only marks", () => {
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis">
      <mark name="0"/>…
      <mark name="1"/>Keep this.
      <mark name="2"/>
    </speak>`;
    expect(parseSsmlMarks(ssml)).toEqual([{ name: "1", text: "Keep this." }]);
  });

  it("falls back to all text when there are no usable marks", () => {
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis">Just words.</speak>`;
    expect(parseSsmlMarks(ssml)).toEqual([{ name: "", text: "Just words." }]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseSsmlMarks("")).toEqual([]);
    expect(parseSsmlMarks("   ")).toEqual([]);
  });
});

describe("tts rate / voice prefs", () => {
  it("clamps and snaps rate to 0.1 steps", () => {
    expect(parseTtsRate("1")).toBe(1);
    expect(parseTtsRate(0.1)).toBe(0.5);
    expect(parseTtsRate(3)).toBe(2);
    expect(parseTtsRate("1.24")).toBe(1.2);
    expect(parseTtsRate("nope")).toBe(DEFAULT_TTS_RATE);
    expect(parseTtsRate(undefined)).toBe(DEFAULT_TTS_RATE);
  });

  it("round-trips rate and voice through localStorage", () => {
    saveTtsRate(1.5);
    expect(localStorage.getItem(TTS_RATE_KEY)).toBe("1.5");
    expect(loadTtsRate()).toBe(1.5);
    saveTtsVoice("mock://zh");
    expect(loadTtsVoice()).toBe("mock://zh");
  });

  it("returns defaults when storage is empty or invalid", () => {
    expect(loadTtsRate()).toBe(DEFAULT_TTS_RATE);
    expect(loadTtsVoice()).toBe("");
    localStorage.setItem(TTS_RATE_KEY, "abc");
    expect(loadTtsRate()).toBe(DEFAULT_TTS_RATE);
  });
});

describe("pickDefaultVoice", () => {
  const voices = [
    { voiceURI: "en", name: "English", lang: "en-US" },
    { voiceURI: "zh", name: "Chinese", lang: "zh-CN" },
  ] as SpeechSynthesisVoice[];

  it("prefers a voice matching the UI or book language", () => {
    expect(pickDefaultVoice(voices, ["zh-CN"])?.voiceURI).toBe("zh");
    expect(pickDefaultVoice(voices, ["en"])?.voiceURI).toBe("en");
  });

  it("falls back to the first voice", () => {
    expect(pickDefaultVoice(voices, ["ja"])?.voiceURI).toBe("en");
    expect(pickDefaultVoice([], ["zh"])).toBeUndefined();
  });
});

describe("preferredTtsLangs", () => {
  it("dedupes document and book languages", () => {
    expect(preferredTtsLangs("zh-CN", "zh-CN")).toContain("zh-CN");
    expect(preferredTtsLangs("en", "zh-CN")[0]).toBe("en");
  });
});

describe("waitForVoices", () => {
  it("resolves immediately when voices are already listed", async () => {
    const voices = [{ voiceURI: "a", name: "A", lang: "en" }] as SpeechSynthesisVoice[];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    await expect(waitForVoices(50)).resolves.toEqual(voices);
  });

  it("waits for voiceschanged when the first list is empty", async () => {
    const voices = [{ voiceURI: "b", name: "B", lang: "en" }] as SpeechSynthesisVoice[];
    let listener: (() => void) | undefined;
    let listed: SpeechSynthesisVoice[] = [];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => listed,
      addEventListener: (_type: string, next: () => void) => {
        listener = next;
      },
      removeEventListener: vi.fn(),
    });
    const pending = waitForVoices(500);
    listed = voices;
    listener?.();
    await expect(pending).resolves.toEqual(voices);
  });
});
