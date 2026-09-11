import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { AgentToolCall } from "@/types/agent";
import { ToolCallHeader } from "./ToolCallCard";

/** A mind map is a derived view: it renders only from the tool call's persisted params. */
interface MindmapParams {
  title: string;
  outline: string;
}

function mindmapParams(params: unknown): MindmapParams | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const { title, outline } = params as Record<string, unknown>;
  if (typeof title !== "string" || typeof outline !== "string") return null;
  return { title, outline };
}

interface MindmapTheme {
  colors: string[];
  background: string;
  foreground: string;
}

/** Bind the markmap palette to the app's CSS theme tokens so dark mode works. */
function readMindmapTheme(): MindmapTheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    colors: ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"].map((token) =>
      read(token, "#888888"),
    ),
    background: read("--background", "#ffffff"),
    foreground: read("--foreground", "#000000"),
  };
}

function outlineStartsWithHeading(outline: string): boolean {
  return /^#{1,6}\s+\S/.test(outline.trimStart());
}

/** Build the markdown markmap renders: the title becomes the map root unless the outline opens with its own root heading. */
function mindmapMarkdown({ title, outline }: MindmapParams): string {
  return outlineStartsWithHeading(outline) ? outline : `# ${title}\n\n${outline}`;
}

function sanitizeFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000]/g, "").trim();
  return clean || "mindmap";
}

/**
 * The interactive mind map canvas. markmap is loaded lazily so the chat
 * bundle does not pay for d3 until a map is actually expanded.
 */
function MindmapCanvas({ params }: { params: MindmapParams }) {
  const { t } = useT();
  const holderRef = useRef<HTMLDivElement>(null);

  const render = useCallback(async () => {
    const holder = holderRef.current;
    if (!holder) return;
    const [{ Transformer }, { Markmap, deriveOptions }] = await Promise.all([
      import("markmap-lib"),
      import("markmap-view"),
    ]);
    if (!holderRef.current) return; // unmounted while loading
    const { root, frontmatter } = new Transformer().transform(mindmapMarkdown(params));
    const theme = readMindmapTheme();
    const options = deriveOptions({
      ...(frontmatter?.markmap ?? {}),
      color: theme.colors,
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "markmap");
    holder.replaceChildren(svg);
    const markmap = Markmap.create(svg, options, root);
    void markmap.fit();
  }, [params]);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | undefined;
    void render();
    // Re-render when the resolved theme flips (the `dark` class on <html>).
    observer = new MutationObserver((records) => {
      if (disposed) return;
      if (records.some((record) => record.attributeName === "class")) void render();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [render]);

  const exportSvg = useCallback(async () => {
    const svg = holderRef.current?.querySelector("svg");
    if (!svg) return;
    const { globalCSS } = await import("markmap-view");
    const theme = readMindmapTheme();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const viewBox = svg.viewBox.baseVal;
    const width = Math.ceil(viewBox.width || svg.getBoundingClientRect().width || 800);
    const height = Math.ceil(viewBox.height || svg.getBoundingClientRect().height || 600);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `${globalCSS}\n.markmap{color:${theme.foreground};}\nsvg{background-color:${theme.background};}`;
    clone.insertBefore(style, clone.firstChild);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    try {
      await invoke("save_text_file", {
        defaultName: `${sanitizeFileName(params.title)}.svg`,
        contents: xml,
      });
    } catch {
      // Cancelled save dialog is the normal path; anything else is non-fatal.
    }
  }, [params.title]);

  return (
    <div className="relative pb-1">
      <div
        ref={holderRef}
        className="mindmap-canvas h-96 w-full overflow-hidden rounded-md border bg-background text-foreground"
        data-testid="mindmap-canvas"
      />
      <button
        type="button"
        onClick={() => void exportSvg()}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Download className="h-3 w-3" aria-hidden="true" />
        <span className="mindmap-export-label">{t("chat.exportSvg")}</span>
      </button>
    </div>
  );
}

/**
 * The `draw_mindmap` tool-call card: collapsed by default showing the tool
 * name and title only, expanding into the interactive map.
 */
export function MindmapCard({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const error = call.done && call.isError === true;
  const params = mindmapParams(call.params);
  // The runtime always persists the receipt as a JSON string.
  const resultText = typeof call.result === "string" ? call.result : "";

  return (
    <div className="-ml-1 rounded px-1 transition-colors hover:bg-muted/40">
      <ToolCallHeader
        call={call}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        summary={params?.title}
      />
      {expanded && (
        <div className="space-y-1 pb-1">
          {error ? (
            resultText && (
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-destructive">
                {resultText}
              </pre>
            )
          ) : (
            params && <MindmapCanvas params={params} />
          )}
        </div>
      )}
    </div>
  );
}
