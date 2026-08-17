import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { t } from "@/lib/i18n";
import {
  isIgnorableSpeechError,
  loadTtsRate,
  loadTtsVoice,
  parseSsmlMarks,
  parseTtsRate,
  pickDefaultVoice,
  preferredTtsLangs,
  saveTtsRate,
  saveTtsVoice,
  waitForVoices,
  type SsmlMark,
} from "@/lib/reader-tts";

export interface ReaderTtsHandle {
  initTts: () => Promise<boolean>;
  ttsSpeakOrigin: (source?: "auto" | "visible") => string | undefined;
  ttsNext: () => string | undefined;
  ttsResume: () => string | undefined;
  ttsSetMark: (mark: string) => void;
  clearTtsHighlight: () => void;
  advanceTtsSection: () => Promise<string | undefined>;
}

export type TtsStatus = "idle" | "playing" | "paused";

export interface TtsVoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
}

export interface UseReaderTtsOptions {
  readerRef: RefObject<ReaderTtsHandle | null>;
  bookHidden: boolean;
  fileKey: string | null;
  bookLang?: string | null;
}

function toVoiceOptions(voices: readonly SpeechSynthesisVoice[]): TtsVoiceOption[] {
  return voices.map((voice) => ({
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
  }));
}

function resolveVoice(
  voices: readonly SpeechSynthesisVoice[],
  savedURI: string,
  bookLang?: string | null,
): SpeechSynthesisVoice | undefined {
  if (savedURI) {
    const saved = voices.find((voice) => voice.voiceURI === savedURI);
    if (saved) return saved;
  }
  return pickDefaultVoice(
    voices,
    preferredTtsLangs(document.documentElement.lang, bookLang),
  );
}

export function useReaderTts({
  readerRef,
  bookHidden,
  fileKey,
  bookLang,
}: UseReaderTtsOptions) {
  const [status, setStatus] = useState<TtsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rate, setRateState] = useState(loadTtsRate);
  const [voiceURI, setVoiceURIState] = useState(loadTtsVoice);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [noVoices, setNoVoices] = useState(false);

  const statusRef = useRef(status);
  statusRef.current = status;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const voiceURIRef = useRef(voiceURI);
  voiceURIRef.current = voiceURI;
  const bookHiddenRef = useRef(bookHidden);
  bookHiddenRef.current = bookHidden;
  const bookLangRef = useRef(bookLang);
  bookLangRef.current = bookLang;
  const liveVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const remainingRef = useRef<SsmlMark[]>([]);
  const genRef = useRef(0);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const bumpGen = () => {
    genRef.current += 1;
    if (speakTimerRef.current !== undefined) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = undefined;
    }
    return genRef.current;
  };

  const cancelSpeech = () => {
    bumpGen();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };

  const stop = useCallback(() => {
    cancelSpeech();
    remainingRef.current = [];
    readerRef.current?.clearTtsHighlight();
    statusRef.current = "idle";
    setStatus("idle");
  }, [readerRef]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const beginSsmlRef = useRef<(ssml: string, gen: number) => void>(() => {});

  const speakMarks = (marks: SsmlMark[], startIndex: number, gen: number) => {
    if (typeof speechSynthesis === "undefined") return;
    const speakOne = (index: number) => {
      if (gen !== genRef.current) return;
      if (index >= marks.length) {
        remainingRef.current = [];
        void advanceAfterBlock(gen);
        return;
      }
      remainingRef.current = marks.slice(index);
      const mark = marks[index];
      const utterance = new SpeechSynthesisUtterance(mark.text);
      utterance.rate = rateRef.current;
      const voice = resolveVoice(
        liveVoicesRef.current,
        voiceURIRef.current,
        bookLangRef.current,
      );
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.onstart = () => {
        if (gen !== genRef.current) return;
        if (mark.name) readerRef.current?.ttsSetMark(mark.name);
      };
      utterance.onend = () => {
        if (gen !== genRef.current) return;
        speakOne(index + 1);
      };
      utterance.onerror = (event) => {
        if (isIgnorableSpeechError(event.error)) return;
        if (gen !== genRef.current) return;
        stopRef.current();
        setError(t("reader.ttsError", { message: event.error }));
      };
      speechSynthesis.speak(utterance);
    };
    speakOne(startIndex);
  };

  const advanceAfterBlock = async (gen: number) => {
    const reader = readerRef.current;
    if (!reader || gen !== genRef.current) return;
    const next = reader.ttsNext();
    if (next) {
      beginSsmlRef.current(next, gen);
      return;
    }
    const section = await reader.advanceTtsSection();
    if (gen !== genRef.current) return;
    if (!section) {
      stopRef.current();
      return;
    }
    beginSsmlRef.current(section, gen);
  };

  beginSsmlRef.current = (ssml: string, gen: number) => {
    const marks = parseSsmlMarks(ssml);
    if (marks.length === 0) {
      void advanceAfterBlock(gen);
      return;
    }
    setStatus("playing");
    speakMarks(marks, 0, gen);
  };

  const ensureVoices = async (): Promise<SpeechSynthesisVoice[]> => {
    if (liveVoicesRef.current.length > 0) return liveVoicesRef.current;
    const list = await waitForVoices();
    liveVoicesRef.current = list;
    setVoices(toVoiceOptions(list));
    setNoVoices(list.length === 0);
    return list;
  };

  const play = useCallback(() => {
    if (bookHiddenRef.current) return;
    if (statusRef.current === "playing") return;
    const reader = readerRef.current;
    if (!reader) return;

    if (statusRef.current === "paused") {
      const gen = bumpGen();
      setError(null);
      statusRef.current = "playing";
      setStatus("playing");
      const leftover = remainingRef.current;
      if (leftover.length > 0) {
        speakTimerRef.current = setTimeout(() => {
          if (gen !== genRef.current) return;
          speakMarks(leftover, 0, gen);
        }, 0);
        return;
      }
      const ssml = reader.ttsResume();
      if (ssml) {
        speakTimerRef.current = setTimeout(() => {
          if (gen !== genRef.current) return;
          beginSsmlRef.current(ssml, gen);
        }, 0);
        return;
      }
      void advanceAfterBlock(gen);
      return;
    }

    void (async () => {
      const gen = bumpGen();
      setError(null);
      statusRef.current = "playing";
      setStatus("playing");
      const list = await ensureVoices();
      if (gen !== genRef.current) return;
      if (list.length === 0) {
        statusRef.current = "idle";
        setError(t("reader.ttsNoVoices"));
        setStatus("idle");
        return;
      }
      const voice = resolveVoice(list, voiceURIRef.current, bookLangRef.current);
      if (voice && voice.voiceURI !== voiceURIRef.current) {
        voiceURIRef.current = voice.voiceURI;
        setVoiceURIState(voice.voiceURI);
        saveTtsVoice(voice.voiceURI);
      }
      const ok = await reader.initTts();
      if (gen !== genRef.current) return;
      if (!ok) {
        statusRef.current = "idle";
        setError(t("reader.ttsInitFailed"));
        setStatus("idle");
        return;
      }
      const ssml = reader.ttsSpeakOrigin();
      if (!ssml) {
        const section = await reader.advanceTtsSection();
        if (gen !== genRef.current) return;
        if (!section) {
          stopRef.current();
          return;
        }
        beginSsmlRef.current(section, gen);
        return;
      }
      beginSsmlRef.current(ssml, gen);
    })();
  }, [readerRef]);

  const pause = useCallback(() => {
    if (statusRef.current !== "playing") return;
    const hadQueue = remainingRef.current.length > 0;
    cancelSpeech();
    if (!hadQueue) {
      remainingRef.current = [];
      readerRef.current?.clearTtsHighlight();
      statusRef.current = "idle";
      setStatus("idle");
      return;
    }
    statusRef.current = "paused";
    setStatus("paused");
  }, [readerRef]);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing") pause();
    else play();
  }, [pause, play]);

  const setRate = useCallback((next: number) => {
    const parsed = parseTtsRate(next);
    rateRef.current = parsed;
    setRateState(parsed);
    saveTtsRate(parsed);
  }, []);

  const setVoice = useCallback((next: string) => {
    voiceURIRef.current = next;
    setVoiceURIState(next);
    saveTtsVoice(next);
  }, []);

  const onUserRelocate = useCallback(() => {
    if (statusRef.current === "idle") return;
    if (bookHiddenRef.current) return;
    const reader = readerRef.current;
    if (!reader) return;
    const gen = bumpGen();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setError(null);
    statusRef.current = "playing";
    setStatus("playing");
    void (async () => {
      const ok = await reader.initTts();
      if (gen !== genRef.current) return;
      if (!ok) {
        stopRef.current();
        return;
      }
      const ssml = reader.ttsSpeakOrigin("visible");
      if (!ssml) {
        stopRef.current();
        return;
      }
      speakTimerRef.current = setTimeout(() => {
        if (gen !== genRef.current) return;
        beginSsmlRef.current(ssml, gen);
      }, 0);
    })();
  }, [readerRef]);

  useEffect(() => {
    let cancelled = false;
    void waitForVoices().then((list) => {
      if (cancelled) return;
      liveVoicesRef.current = list;
      setVoices(toVoiceOptions(list));
      setNoVoices(list.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (bookHidden) stopRef.current();
  }, [bookHidden]);

  useEffect(() => {
    return () => {
      stopRef.current();
    };
  }, [fileKey]);

  return {
    status,
    error,
    rate,
    voiceURI,
    voices,
    noVoices,
    play,
    pause,
    toggle,
    stop,
    setRate,
    setVoice,
    onUserRelocate,
  };
}
