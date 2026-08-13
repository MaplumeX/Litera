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
    prev(): Promise<void>;
    next(): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    close?(): void;
  }
}
