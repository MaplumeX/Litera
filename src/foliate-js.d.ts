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
  }

  export const makeBook: (file: File | Blob) => Promise<Book>;

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
    close?(): void;
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
