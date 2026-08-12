/**
 * EPUB parsing + FTS5 full-text search module.
 *
 * Parses EPUB files using adm-zip (unzip) + manual OPF XML parsing,
 * caches chapter text in a Map, and builds an in-memory SQLite FTS5 index
 * for full-text search via fts5-sql-bundle (WASM).
 */

import AdmZip from "adm-zip";
import { initSqlJs, type Database, type SqlJsStatic } from "fts5-sql-bundle";
import { join } from "node:path";

// --- Types ------------------------------------------------------------------

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  totalChapters: number;
}

export interface TocEntry {
  index: number;
  label: string;
  href: string;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface SpineItem {
  idref: string;
}

interface ParsedEpub {
  metadata: BookMetadata;
  toc: TocEntry[];
  /** Spine manifest items in reading order, with href resolved against OPF dir. */
  spineHrefs: string[];
}

// --- Global state -----------------------------------------------------------

let sqlStatic: SqlJsStatic | null = null;

async function getSqlStatic(): Promise<SqlJsStatic> {
  if (!sqlStatic) {
    // The build copies this asset next to the bundled entry. @yao-pkg/pkg then
    // embeds the same relative path in its read-only snapshot filesystem.
    sqlStatic = await initSqlJs({
      locateFile: (file: string) => join(__dirname, file),
    });
  }
  return sqlStatic;
}

/** Exercise the packaged FTS5 WASM without requiring an EPUB fixture. */
export async function runFtsSmoke(): Promise<void> {
  const sql = await getSqlStatic();
  const db = new sql.Database();
  try {
    db.run("CREATE VIRTUAL TABLE smoke USING fts5(content)");
    db.run("INSERT INTO smoke(content) VALUES (?)", ["litera sidecar ready"]);
    const result = db.exec("SELECT count(*) AS matches FROM smoke WHERE content MATCH 'sidecar'");
    if (result[0]?.values[0]?.[0] !== 1) {
      throw new Error("FTS5 smoke query returned an unexpected result");
    }
  } finally {
    db.close();
  }
}

/** Current book state — reset on each book_opened. */
let currentBook: {
  metadata: BookMetadata;
  toc: TocEntry[];
  /** chapter index → plain text */
  chapterTexts: Map<number, string>;
  fts: Database | null;
} | null = null;

// --- EPUB parsing -----------------------------------------------------------

/**
 * Parse an EPUB file from the filesystem.
 *
 * EPUB is a ZIP containing:
 *   META-INF/container.xml → points to the OPF file
 *   <OPF path> → metadata, manifest, spine
 */
function parseEpub(filePath: string): ParsedEpub {
  const zip = new AdmZip(filePath);

  // 1. Read container.xml to find the OPF file path.
  const containerXml = readZipText(zip, "META-INF/container.xml");
  if (!containerXml) throw new Error("EPUB: missing META-INF/container.xml");
  const opfPath = extractOpfPath(containerXml);
  if (!opfPath) throw new Error("EPUB: could not find OPF path in container.xml");

  // 2. Read the OPF file.
  const opfXml = readZipText(zip, opfPath);
  if (!opfXml) throw new Error(`EPUB: OPF file not found: ${opfPath}`);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  // 3. Parse metadata, manifest, spine from OPF.
  const metadata = parseMetadata(opfXml);
  const manifest = parseManifest(opfXml);
  const spine = parseSpine(opfXml);

  // 4. Resolve spine hrefs (manifest idref → href, resolved against opfDir).
  const spineHrefs: string[] = [];
  for (const item of spine) {
    const manifestItem = manifest.find((m) => m.id === item.idref);
    if (manifestItem) {
      spineHrefs.push(resolveHref(opfDir, manifestItem.href));
    }
  }

  // 5. Parse TOC (nav.xhtml for EPUB 3, toc.ncx for EPUB 2).
  const toc = parseToc(zip, opfDir, opfXml, manifest);

  // Total chapters = spine length.
  return {
    metadata: { ...metadata, totalChapters: spineHrefs.length },
    toc,
    spineHrefs,
  };
}

/** Read a text file from the zip, returning undefined if not found. */
function readZipText(zip: AdmZip, path: string): string | undefined {
  // AdmZip entries may use backslashes on Windows; normalize.
  const normalized = path.replace(/\\/g, "/");
  let entry = zip.getEntry(normalized);
  if (!entry) {
    // Try without leading slash or with different separators.
    entry = zip.getEntry(normalized.replace(/^\//, ""));
  }
  if (!entry) return undefined;
  return entry.getData().toString("utf8");
}

/** Extract the OPF file path from container.xml. */
function extractOpfPath(containerXml: string): string | undefined {
  const match = containerXml.match(/<rootfile[^>]+full-path=["']([^"']+)["']/i);
  return match?.[1];
}

/** Parse metadata from OPF XML. */
function parseMetadata(opfXml: string): { title: string; author: string; language: string } {
  const title = matchTag(opfXml, "dc:title") ?? matchTag(opfXml, "title") ?? "Unknown";
  const author = matchTag(opfXml, "dc:creator") ?? matchTag(opfXml, "creator") ?? "Unknown";
  const language = matchTag(opfXml, "dc:language") ?? matchTag(opfXml, "language") ?? "en";
  return { title, author, language };
}

/** Extract text content of a tag (handles namespace prefixes like dc:). */
function matchTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegex(tagName)}[^>]*>([^<]*)</${escapeRegex(tagName)}>`, "i");
  const match = xml.match(re);
  return match?.[1]?.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse manifest items from OPF XML. */
function parseManifest(opfXml: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  const re = /<item\b[^>]*\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(opfXml)) !== null) {
    const itemXml = match[0];
    const id = attr(itemXml, "id");
    const href = attr(itemXml, "href");
    const mediaType = attr(itemXml, "media-type") ?? "";
    if (id && href) {
      items.push({ id, href: decodeURIComponent(href), mediaType });
    }
  }
  return items;
}

/** Parse spine items from OPF XML. */
function parseSpine(opfXml: string): SpineItem[] {
  const items: SpineItem[] = [];
  const re = /<itemref\b[^>]*\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(opfXml)) !== null) {
    const idref = attr(match[0], "idref");
    if (idref) items.push({ idref });
  }
  return items;
}

/** Parse TOC from EPUB 3 nav.xhtml or EPUB 2 toc.ncx. */
function parseToc(zip: AdmZip, opfDir: string, opfXml: string, manifest: ManifestItem[]): TocEntry[] {
  // EPUB 3: look for nav item with properties="nav"
  const navItem = manifest.find((m) => m.mediaType === "application/xhtml+xml" && /properties=["'].*\bnav\b/i.test(getManifestItemXml(opfXml, m.id)));
  if (navItem) {
    const navHref = resolveHref(opfDir, navItem.href);
    const navHtml = readZipText(zip, navHref);
    if (navHtml) return parseNavToc(navHtml);
  }

  // EPUB 2: look for ncx item (application/x-dtbncx+xml)
  const ncxItem = manifest.find((m) => m.mediaType === "application/x-dtbncx+xml");
  if (ncxItem) {
    const ncxHref = resolveHref(opfDir, ncxItem.href);
    const ncxXml = readZipText(zip, ncxHref);
    if (ncxXml) return parseNcxToc(ncxXml);
  }

  return [];
}

/** Get the raw <item> XML for a manifest id to check properties. */
function getManifestItemXml(opfXml: string, id: string): string {
  const re = new RegExp(`<item\\b[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*/>`, "i");
  return opfXml.match(re)?.[0] ?? "";
}

/** Parse TOC from EPUB 3 nav.xhtml. */
function parseNavToc(navHtml: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(navHtml)) !== null) {
    const href = match[1];
    const label = stripTags(match[2]).trim();
    // Skip anchor-only links (href="#...") — they point within the same file.
    if (label) {
      entries.push({ index: index, label, href: href.split("#")[0] });
      index++;
    }
  }
  return entries;
}

/** Parse TOC from EPUB 2 toc.ncx. */
function parseNcxToc(ncxXml: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const re = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(ncxXml)) !== null) {
    const block = match[1];
    const labelMatch = block.match(/<text>([^<]*)<\/text>/i);
    const hrefMatch = block.match(/<content\b[^>]*src=["']([^"']+)["']/i);
    const label = labelMatch?.[1]?.trim();
    const href = hrefMatch?.[1]?.split("#")[0];
    if (label && href) {
      entries.push({ index, label, href });
      index++;
    }
  }
  return entries;
}

/** Resolve a href relative to the OPF directory. */
function resolveHref(opfDir: string, href: string): string {
  if (href.startsWith("/")) return href.slice(1);
  return join(opfDir, href).replace(/\\/g, "/");
}

/** Strip HTML tags from text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/** Convert HTML to plain text (strip tags, collapse whitespace). */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Get an attribute value from an XML tag string. */
function attr(xml: string, name: string): string | undefined {
  const re = new RegExp(`\\b${escapeRegex(name)}=["']([^"']*)["']`, "i");
  return xml.match(re)?.[1];
}

// --- Book loading + FTS5 ----------------------------------------------------

/**
 * Load an EPUB file, extract all chapter texts, and build FTS5 index.
 * Resets all global book state.
 */
export async function loadBook(filePath: string): Promise<BookMetadata> {
  // Reset state.
  if (currentBook?.fts) currentBook.fts.close();
  currentBook = null;

  const parsed = parseEpub(filePath);
  const zip = new AdmZip(filePath);

  // Extract chapter texts from spine hrefs.
  const chapterTexts = new Map<number, string>();
  for (let i = 0; i < parsed.spineHrefs.length; i++) {
    const html = readZipText(zip, parsed.spineHrefs[i]);
    if (html) {
      chapterTexts.set(i, htmlToText(html));
    }
  }

  // Initialize FTS5 database.
  const sql = await getSqlStatic();
  const db = new sql.Database();
  db.run("CREATE VIRTUAL TABLE chapters USING fts5(content, tokenize='trigram')");
  for (const [index, text] of chapterTexts) {
    db.run("INSERT INTO chapters (rowid, content) VALUES (?, ?)", [index + 1, text]);
  }

  currentBook = {
    metadata: parsed.metadata,
    toc: parsed.toc,
    chapterTexts,
    fts: db,
  };

  return parsed.metadata;
}

// --- Book accessors (for tools) ---------------------------------------------

export function isBookLoaded(): boolean {
  return currentBook !== null;
}

export function getBookMetadata(): BookMetadata {
  if (!currentBook) throw new Error("No book loaded. Open a book first.");
  return currentBook.metadata;
}

export function getToc(): TocEntry[] {
  if (!currentBook) throw new Error("No book loaded. Open a book first.");
  return currentBook.toc;
}

export function readChapter(index: number): string {
  if (!currentBook) throw new Error("No book loaded. Open a book first.");
  const text = currentBook.chapterTexts.get(index);
  if (text === undefined) {
    throw new Error(
      `Chapter index ${index} not found. Valid range: 0–${currentBook.metadata.totalChapters - 1}.`,
    );
  }
  return text;
}

export interface SearchResult {
  chapterIndex: number;
  excerpt: string;
}

export function searchInBook(query: string): SearchResult[] {
  if (!currentBook || !currentBook.fts) throw new Error("No book loaded. Open a book first.");
  const stmt = currentBook.fts.prepare(
    "SELECT rowid, snippet(chapters, 0, '【', '】', '…', 16) AS excerpt FROM chapters WHERE content MATCH ?",
  );
  stmt.bind([query]);
  const results: SearchResult[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push({
      chapterIndex: row.rowid - 1,
      excerpt: String(row.excerpt),
    });
  }
  stmt.free();
  return results;
}
