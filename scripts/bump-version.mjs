import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  rootPkg: join(root, "package.json"),
  tauri: join(root, "src-tauri", "tauri.conf.json"),
  cargo: join(root, "src-tauri", "Cargo.toml"),
  rootLock: join(root, "package-lock.json"),
};

const arg = process.argv[2];
if (arg === "--check") {
  checkVersions();
} else if (arg && VERSION_RE.test(arg)) {
  writeVersions(arg);
} else {
  process.stderr.write("Usage: node scripts/bump-version.mjs <x.y.z>\n");
  process.stderr.write("       node scripts/bump-version.mjs --check\n");
  process.exit(1);
}

function readJsonVersion(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (typeof json.version !== "string") {
    throw new Error(`${path} is missing a top-level version`);
  }
  return json.version;
}

function readCargoPackageVersion(path) {
  const text = readFileSync(path, "utf8");
  const section = text.match(/^\[package\][^\[]*/m);
  if (!section) {
    throw new Error(`${path} has no [package] section`);
  }
  const match = section[0].match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`${path} [package] has no version`);
  }
  return match[1];
}

function collectVersions() {
  return {
    [files.rootPkg]: readJsonVersion(files.rootPkg),
    [files.tauri]: readJsonVersion(files.tauri),
    [files.cargo]: readCargoPackageVersion(files.cargo),
  };
}

function lockfileVersions(path) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const found = [];
  if (typeof json.version === "string") {
    found.push(json.version);
  }
  const pkgVersion = json.packages?.[""]?.version;
  if (typeof pkgVersion === "string") {
    found.push(pkgVersion);
  }
  return found;
}

function assertLockstep(expected) {
  const versions = collectVersions();
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== expected)
    .map(([path, version]) => `  ${path}: ${version}`);
  if (mismatches.length) {
    throw new Error(
      `Version lockstep failed (expected ${expected}):\n${mismatches.join("\n")}`,
    );
  }
  for (const lock of [files.rootLock]) {
    for (const version of lockfileVersions(lock)) {
      if (version !== expected) {
        throw new Error(`${lock} root version is ${version}, expected ${expected}`);
      }
    }
  }
}

function checkVersions() {
  const expected = readJsonVersion(files.tauri);
  if (!VERSION_RE.test(expected)) {
    throw new Error(`${files.tauri} version '${expected}' is not x.y.z`);
  }
  assertLockstep(expected);

  const ref = process.env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    if (!tag.startsWith("v") || tag.slice(1) !== expected) {
      throw new Error(`Tag '${tag}' does not match app version ${expected}`);
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${expected}\n`);
  }
  process.stdout.write(`${expected}\n`);
}

function replaceJsonVersion(path, version) {
  const text = readFileSync(path, "utf8");
  readJsonVersion(path);
  const next = text.replace(/^ {2}"version": "[^"]+"/m, `  "version": "${version}"`);
  if (next === text && readJsonVersion(path) !== version) {
    throw new Error(`Could not update version in ${path}`);
  }
  if (next !== text) {
    writeFileSync(path, next);
  }
}

function replaceCargoPackageVersion(path, version) {
  const text = readFileSync(path, "utf8");
  const sectionMatch = text.match(/^\[package\][^\[]*/m);
  if (!sectionMatch || sectionMatch.index === undefined) {
    throw new Error(`${path} has no [package] section`);
  }
  const section = sectionMatch[0];
  if (!/^version\s*=\s*"[^"]+"/m.test(section)) {
    throw new Error(`${path} [package] has no version`);
  }
  const updated = section.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`,
  );
  if (updated === section) {
    return;
  }
  writeFileSync(
    path,
    text.slice(0, sectionMatch.index) + updated + text.slice(sectionMatch.index + section.length),
  );
}

function replaceLockfileRootVersion(path, version) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const json = JSON.parse(text);
  if (typeof json.version !== "string") {
    return;
  }
  let next = text.replace(/^ {2}"version": "[^"]+"/m, `  "version": "${version}"`);
  if (typeof json.packages?.[""]?.version === "string") {
    next = next.replace(
      /^ {4}"": \{\n {6}"name": "[^"]+",\n {6}"version": "[^"]+"/m,
      (block) => block.replace(/"version": "[^"]+"/, `"version": "${version}"`),
    );
  }
  if (next !== text) {
    writeFileSync(path, next);
  }
}

function writeVersions(version) {
  replaceJsonVersion(files.rootPkg, version);
  replaceJsonVersion(files.tauri, version);
  replaceCargoPackageVersion(files.cargo, version);
  replaceLockfileRootVersion(files.rootLock, version);
  assertLockstep(version);
  process.stdout.write(`${version}\n`);
}
