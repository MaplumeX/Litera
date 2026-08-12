import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import {
  BookWorker,
  isBookWorkerThread,
  runBookWorker,
} from "../book-worker.js";
import { SupersedingResource } from "../dispatcher.js";

function createEpub(path: string, title: string, chapterText: string, chapterCount: number): void {
  const zip = new AdmZip();
  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`),
  );
  const manifest: string[] = [];
  const spine: string[] = [];
  for (let index = 0; index < chapterCount; index += 1) {
    const id = `chapter-${index}`;
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    zip.addFile(
      `OEBPS/${id}.xhtml`,
      Buffer.from(`<html><body><p>${chapterText} ${index}</p></body></html>`),
    );
  }
  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(`<?xml version="1.0"?>
      <package><metadata><dc:title>${title}</dc:title><dc:creator>Litera</dc:creator><dc:language>en</dc:language></metadata>
      <manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`),
  );
  zip.writeZip(path);
}

if (isBookWorkerThread()) {
  runBookWorker();
} else {
  test("slow A then B leaves worker data bound to B and rejects stale A RPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "litera-book-worker-"));
    const pathA = join(directory, "a.epub");
    const pathB = join(directory, "b.epub");
    createEpub(pathA, "Book A", "alpha-only-token", 120);
    createEpub(pathB, "Book B", "bravo-only-token", 1);
    const worker = new BookWorker();
    try {
      const loadA = worker.load(pathA, "book-a", 1);
      const loadB = worker.load(pathB, "book-b", 2);
      const [resultA, resultB] = await Promise.all([loadA, loadB]);
      assert.equal(resultA.metadata.title, "Book A");
      assert.equal(resultB.metadata.title, "Book B");
      assert.match(await worker.readChapter("book-b", 2, 0), /bravo-only-token/);
      assert.equal((await worker.search("book-b", 2, "bravo")).length, 1);
      await assert.rejects(
        worker.readChapter("book-a", 1, 0),
        /does not match the loaded book generation/,
      );
    } finally {
      await worker.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("replacing a loading worker lets B finish independently from A", async () => {
    const directory = await mkdtemp(join(tmpdir(), "litera-book-worker-supersede-"));
    const pathA = join(directory, "a.epub");
    const pathB = join(directory, "b.epub");
    createEpub(pathA, "Book A", "alpha-only-token", 300);
    createEpub(pathB, "Book B", "bravo-only-token", 1);
    const terminationErrors: unknown[] = [];
    const workers = new SupersedingResource(
      () => new BookWorker(),
      (error) => terminationErrors.push(error),
    );
    try {
      const workerA = workers.replace();
      const loadA = workerA.load(pathA, "book-a", 1).catch(() => undefined);
      const workerB = workers.replace();
      const resultB = await workerB.load(pathB, "book-b", 2);

      assert.equal(workers.current(), workerB);
      assert.equal(resultB.metadata.title, "Book B");
      assert.match(await workerB.readChapter("book-b", 2, 0), /bravo-only-token/);
      await assert.rejects(workerA.readChapter("book-a", 1, 0), /stopped/);
      await loadA;
      assert.deepEqual(terminationErrors, []);
    } finally {
      await workers.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
