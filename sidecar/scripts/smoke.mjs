import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { resolveTarget } from "./target.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, "..", "..");
const { triple, executableSuffix } = resolveTarget();
const executable = join(
  repoDir,
  "src-tauri",
  "binaries",
  `litera-sidecar-${triple}${executableSuffix}`,
);
const emptyPath = await mkdtemp(join(tmpdir(), "litera-sidecar-path-"));

try {
  const binary = await readFile(executable);
  if (binary.includes(Buffer.from(repoDir))) {
    throw new Error("Packaged sidecar contains the build machine source path");
  }

  const env = { ...process.env, PATH: emptyPath, Path: emptyPath };
  // @yao-pkg's Unix runtime treats Node child_process socketpair stdin as EOF.
  // Tauri uses an OS pipe, so relay through /bin/cat to exercise the same pipe
  // semantics while keeping PATH empty. Windows child pipes work directly.
  const child = process.platform === "win32"
    ? spawn(executable, [], { env, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(
        "/bin/sh",
        ["-c", 'exec /bin/cat | exec "$1"', "litera-sidecar-relay", executable],
        { env, stdio: ["pipe", "pipe", "pipe"] },
      );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });

  const outcome = new Promise((resolveOutcome, reject) => {
    let sawReady = false;
    let pongCount = 0;
    let completed = false;
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ready/pong. stderr: ${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    }, 20_000);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!completed) {
        reject(
          new Error(
            `Sidecar exited before smoke completed (${code ?? signal}). stderr: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
      }
    });
    lines.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        clearTimeout(timeout);
        reject(new Error(`Sidecar stdout was not JSONL: ${line}`));
        return;
      }
      if (message.type === "ready") {
        sawReady = true;
      } else if (message.type === "pong" && message.fts5 === true) {
        pongCount += 1;
        if (pongCount === 1) {
          // Verify the executable remains a long-running stdio server after
          // bootstrap rather than only surviving until its first response.
          setTimeout(() => child.stdin.write('{"type":"ping"}\n'), 50);
        } else if (sawReady) {
          completed = true;
          clearTimeout(timeout);
          resolveOutcome(undefined);
        }
      } else if (message.type === "error") {
        clearTimeout(timeout);
        reject(new Error(`Sidecar smoke error: ${message.message}`));
      }
    });
    // Rust also sends this bootstrap ping immediately after spawning. Writing
    // before ready removes a pkg stdin startup race while JSONL ordering still
    // requires both ready and two successful pong responses.
    child.stdin.write('{"type":"ping"}\n');
  });

  try {
    await outcome;
    process.stdout.write(
      `Sidecar ready/ping/FTS5 smoke passed for ${triple} without Node on PATH\n`,
    );
  } finally {
    lines.close();
    child.stdin.end();
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
      ]);
    }
    if (child.exitCode === null) child.kill();
  }
} finally {
  await rm(emptyPath, { recursive: true, force: true });
}
