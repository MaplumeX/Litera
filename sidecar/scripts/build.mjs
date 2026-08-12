import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTarget } from "./target.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sidecarDir = resolve(scriptDir, "..");
const repoDir = resolve(sidecarDir, "..");
const distDir = join(sidecarDir, "dist");
const binariesDir = join(repoDir, "src-tauri", "binaries");
const bundlePath = join(distDir, "litera-sidecar.cjs");
const wasmSource = join(
  sidecarDir,
  "node_modules",
  "fts5-sql-bundle",
  "dist",
  "sql-wasm.wasm",
);
const wasmTarget = join(distDir, "sql-wasm.wasm");
const pkgBin = join(
  sidecarDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "pkg.cmd" : "pkg",
);
const esbuildPackage = join(sidecarDir, "node_modules", "esbuild", "package.json");

const { triple, pkgTarget, executableSuffix } = resolveTarget();
const output = join(binariesDir, `litera-sidecar-${triple}${executableSuffix}`);

await mkdir(distDir, { recursive: true });
await mkdir(binariesDir, { recursive: true });
const dependenciesReady = await Promise.all(
  [pkgBin, esbuildPackage, wasmSource].map((path) =>
    stat(path).then(
      () => true,
      () => false,
    ),
  ),
).then((results) => results.every(Boolean));
if (!dependenciesReady) {
  process.stdout.write("Installing sidecar dependencies from package-lock.json\n");
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, "ci"], {
      cwd: sidecarDir,
      stdio: "inherit",
    });
  } else if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm ci"], {
      cwd: sidecarDir,
      stdio: "inherit",
    });
  } else {
    execFileSync("npm", ["ci"], { cwd: sidecarDir, stdio: "inherit" });
  }
}
await stat(wasmSource).catch(() => {
  throw new Error("FTS5 WASM asset is missing; install sidecar dependencies before building");
});
await copyFile(wasmSource, wasmTarget);

const { build } = await import("esbuild");
await build({
  entryPoints: [join(sidecarDir, "index.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  banner: {
    js: 'const __literaImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "__literaImportMetaUrl",
  },
  sourcemap: false,
  logLevel: "warning",
});

const pkgArgs = [
  "--targets",
  pkgTarget,
  "--output",
  output,
  "--config",
  join(sidecarDir, "pkg.config.cjs"),
  bundlePath,
];
const pkgOptions = {
  cwd: sidecarDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PKG_CACHE_PATH: process.env.PKG_CACHE_PATH ?? join(sidecarDir, ".pkg-cache"),
  },
};
if (process.platform === "win32") {
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", pkgBin, ...pkgArgs], pkgOptions);
} else {
  execFileSync(pkgBin, pkgArgs, pkgOptions);
}

if (!executableSuffix) {
  await chmod(output, 0o755);
}

const outputStat = await stat(output);
if (!outputStat.isFile() || outputStat.size < 1_000_000) {
  throw new Error(`Sidecar packaging produced an invalid executable: ${output}`);
}
process.stdout.write(`Built ${output}\n`);
