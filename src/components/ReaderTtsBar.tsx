import { Pause, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { TTS_RATE_RANGE } from "@/lib/reader-tts";
import type { TtsVoiceOption } from "@/lib/use-reader-tts";

interface ReaderTtsBarProps {
  playing: boolean;
  rate: number;
  voiceURI: string;
  voices: TtsVoiceOption[];
  onPause: () => void;
  onPlay?: () => void;
  onStop: () => void;
  onRate: (rate: number) => void;
  onVoice: (voiceURI: string) => void;
}

export function ReaderTtsBar({
  playing,
  rate,
  voiceURI,
  voices,
  onPause,
  onPlay,
  onStop,
  onRate,
  onVoice,
}: ReaderTtsBarProps) {
  const { t } = useT();
  const selected = voiceURI || voices[0]?.voiceURI || "";

  return (
    <div
      data-testid="reader-tts-bar"
      className="flex h-9 shrink-0 items-center gap-2 border-t px-2"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={playing ? t("reader.ttsPause") : t("reader.ttsPlay")}
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <Pause /> : <Volume2 />}
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t("reader.ttsStop")}
        onClick={onStop}
      >
        <Square />
      </Button>
      <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{t("reader.ttsRate")}</span>
        <Slider
          aria-label={t("reader.ttsRate")}
          className="max-w-40"
          value={[rate]}
          min={TTS_RATE_RANGE.min}
          max={TTS_RATE_RANGE.max}
          step={TTS_RATE_RANGE.step}
          onValueChange={([next]) => {
            if (typeof next === "number") onRate(next);
          }}
        />
        <span className="w-8 shrink-0 tabular-nums">{rate.toFixed(1)}</span>
      </label>
      {voices.length > 0 && selected ? (
        <Select value={selected} onValueChange={onVoice}>
          <SelectTrigger
            size="sm"
            className="max-w-48 shadow-none"
            aria-label={t("reader.ttsVoice")}
          >
            <SelectValue placeholder={t("reader.ttsVoice")} />
          </SelectTrigger>
          <SelectContent>
            {voices.map((voice) => (
              <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
