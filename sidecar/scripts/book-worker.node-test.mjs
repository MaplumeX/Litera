import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";

test("book worker generation integration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "litera-book-worker-test-"));
  const output = join(directory, "book-worker-test.cjs");
  try {
    await build({
      entryPoints: [resolve("scripts/book-worker.integration.ts")],
      outfile: output,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      logLevel: "silent",
    });
    execFileSync(process.execPath, ["--test", output], {
      cwd: resolve("."),
      stdio: "inherit",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
