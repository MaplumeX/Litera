/// <reference lib="webworker" />
import {
  bookToc,
  locateQuote,
  parseEpub,
  readChapter,
  readImageFile,
  searchBook,
  type ParsedBook,
} from "./epub-content";
import { prepareModelImage } from "./model-image";

interface WorkerRequest {
  id: string;
  method: string;
  args: unknown[];
}

let book: ParsedBook | null = null;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data;
  try {
    let result: unknown;
    if (method === "open") {
      book = parseEpub(args[1] as ArrayBuffer);
      result = null;
    } else if (!book) {
      throw new Error("No book is open");
    } else if (method === "metadata") {
      result = book.metadata;
    } else if (method === "toc") {
      result = bookToc(book);
    } else if (method === "readChapter") {
      result = readChapter(book, Number(args[0]), Number(args[1] ?? 0));
    } else if (method === "search") {
      result = searchBook(book, args[0] as string[]);
    } else if (method === "readImage") {
      const file = readImageFile(book, String(args[0] ?? ""));
      result = await prepareModelImage(file.src, file.bytes, file.mediaType);
    } else if (method === "locateQuote") {
      result = locateQuote(book, Number(args[0]), String(args[1] ?? ""));
    } else {
      throw new Error("Unknown book worker method");
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
