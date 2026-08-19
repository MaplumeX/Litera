/** Type declarations for foliate.js modules (JS library without bundled types). */

declare module "*/foliate-js/view.js" {
  export interface Book {
    metadata?: {
      title?: string | Record<string, string> | { lang?: string; value: string }[];
      author?: unknown;
      identifier?: string;
      language?: string | string[];
    };
    getCover?(): Promise<Blob | null>;
    destroy?(): void;
    sections: unknown[];
    resolveHref?(href: string): {
      index: number;
      anchor: (doc: Document) => Element | number;
    } | null;
    isExternal?(href: string): boolean;
  }

  export const makeBook: (file: File | Blob) => Promise<Book>;

  export type TtsGranularity = "grapheme" | "word" | "sentence";

  export interface TtsHighlight {
    (range: Range): void;
  }

  export class TTS {
    readonly doc: Document;
    highlight: TtsHighlight;
    constructor(
      doc: Document,
      textWalker: (
        root: Range | Document | DocumentFragment,
        func: (
          strs: string[],
          makeRange: (
            startIndex: number,
            startOffset: number,
            endIndex: number,
            endOffset: number,
          ) => Range,
        ) => Iterable<[string, Range]>,
      ) => Iterable<[string, Range]>,
      highlight: TtsHighlight,
      granularity?: TtsGranularity,
    );
    start(): string | undefined;
    resume(): string | undefined;
    prev(paused?: boolean): string | undefined;
    next(paused?: boolean): string | undefined;
    from(range: Range): string | undefined;
    setMark(mark: string): void;
  }

  export interface FoliateContents {
    index: number;
    doc?: Document;
    overlayer?: {
      add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
      remove(key: string): void;
    };
  }

  export interface FoliateRenderer {
    getContents(): FoliateContents[];
    scrollToAnchor(anchor: Range | number, select?: boolean): Promise<void>;
    setStyles?(css: string): void;
    nextSection?(): Promise<void>;
    next?(distance?: number): Promise<void>;
    /** Content size along the flow axis (scrolled: expanded iframe height). */
    viewSize?: number;
  }

  export class View extends HTMLElement {
    open(book: Book | File): Promise<void>;
    init(opts: Record<string, unknown>): Promise<void>;
    goToFraction(frac: number): Promise<void>;
    goTo(target: string | number | { fraction: number }): Promise<unknown>;
    getSectionFractions(): number[];
    getProgressOf(
      index: number,
      range?: Range,
    ): { tocItem?: { label?: string; href?: string }; pageItem?: unknown };
    getCFI(index: number, range?: Range): string;
    addAnnotation(annotation: { value: string }, remove?: boolean): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    prev(): Promise<void>;
    next(): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    book?: Book & { toc?: unknown[]; sections?: { id?: string; cfi?: string }[] };
    renderer: FoliateRenderer;
    tts: TTS | null;
    mediaOverlay: EventTarget | null;
    lastLocation: {
      cfi?: string;
      range?: Range;
      tocItem?: { label?: string; href?: string };
      fraction?: number;
    } | null;
    initTTS(granularity?: TtsGranularity, highlight?: TtsHighlight): Promise<void>;
    startMediaOverlay(): unknown;
    close(): void;
  }
}

declare module "*/foliate-js/footnotes.js" {
  export class FootnoteHandler extends EventTarget {
    detectFootnotes: boolean;
    handle(book: unknown, e: Event): Promise<unknown> | undefined;
  }
}

declare module "*/foliate-js/tts.js" {
  export type TtsGranularity = "grapheme" | "word" | "sentence";
  export interface TtsHighlight {
    (range: Range): void;
  }
  export class TTS {
    readonly doc: Document;
    highlight: TtsHighlight;
    constructor(
      doc: Document,
      textWalker: (
        root: Range | Document | DocumentFragment,
        func: (
          strs: string[],
          makeRange: (
            startIndex: number,
            startOffset: number,
            endIndex: number,
            endOffset: number,
          ) => Range,
        ) => Iterable<[string, Range]>,
      ) => Iterable<[string, Range]>,
      highlight: TtsHighlight,
      granularity?: TtsGranularity,
    );
    start(): string | undefined;
    resume(): string | undefined;
    prev(paused?: boolean): string | undefined;
    next(paused?: boolean): string | undefined;
    from(range: Range): string | undefined;
    setMark(mark: string): void;
  }
}

declare module "*/foliate-js/overlayer.js" {
  export class Overlayer {
    static highlight(
      rects: DOMRectList | ArrayLike<DOMRect>,
      options?: { color?: string },
    ): SVGElement;
  }
}
