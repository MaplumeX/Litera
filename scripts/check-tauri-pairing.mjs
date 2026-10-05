import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The Tauri CLI refuses to build when a plugin's npm package and Rust crate are
 * not on the same major/minor release, and the failure only surfaces late in
 * `tauri build` — after the JS tests, on every platform. This check runs
 * earlier and names the offending pair.
 *
 * It also verifies that each paired dependency is minor-locked with `~` on both
 * sides. Ranges are checked as well as resolved versions on purpose: a `^`
 * range can resolve to a matching minor today and still let one side drift to a
 * new minor tomorrow, which is exactly how the 0.3.5 release broke (#78 bumped
 * the Rust crate while the npm package stayed behind).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmManifest = join(root, "package.json");
const npmLock = join(root, "package-lock.json");
const cargoManifest = join(root, "src-tauri", "Cargo.toml");
const cargoLock = join(root, "src-tauri", "Cargo.lock");

// npm package -> the Rust crate it must stay in step with.
const pairs = [
  { npm: "@tauri-apps/api", cargo: "tauri" },
  { npm: "@tauri-apps/plugin-http", cargo: "tauri-plugin-http" },
  { npm: "@tauri-apps/plugin-opener", cargo: "tauri-plugin-opener" },
];

// Same rule, but the CLI has no Rust counterpart to compare against: it ships
// from the tauri repository and shares the `tauri` crate's minor release.
const cli = { npm: "@tauri-apps/cli", cargo: "tauri" };

const problems = [];

function majorMinor(version) {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function npmResolved(lock, name) {
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string") {
    throw new Error(`${npmLock} has no resolved version for ${name}`);
  }
  return version;
}

function npmDeclared(manifest, name) {
  const version = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  if (typeof version !== "string") {
    throw new Error(`${npmManifest} does not depend on ${name}`);
  }
  return version;
}

function cargoResolved(lock, crate) {
  const match = lock.match(
    new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = "([^"]+)"`),
  );
  if (!match) {
    throw new Error(`${cargoLock} has no ${crate} package`);
  }
  return match[1];
}

function readCargoDependencies(manifest) {
  const lines = manifest.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "[dependencies]");
  if (start === -1) {
    throw new Error(`${cargoManifest} has no [dependencies] section`);
  }
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith("[")) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

function cargoDeclared(manifest, crate) {
  const body = readCargoDependencies(manifest);
  const inline = new RegExp(`^${crate}\\s*=\\s*\\{[^}]*version\\s*=\\s*"([^"]+)"`, "m");
  const bare = new RegExp(`^${crate}\\s*=\\s*"([^"]+)"`, "m");
  const match = inline.exec(body) ?? bare.exec(body);
  if (!match) {
    throw new Error(`${cargoManifest} [dependencies] has no ${crate}`);
  }
  return match[1];
}

function requireMinorLock(path, spec, name, expected) {
  const locked = /^~(\d+\.\d+)\./.exec(spec);
  if (!locked) {
    problems.push(
      `  ${path}: ${name} is "${spec}" — must be minor-locked ("~${expected}.x") so it cannot drift independently`,
    );
    return;
  }
  if (locked[1] !== expected) {
    problems.push(`  ${path}: ${name} is locked to ${locked[1]}.x, expected ${expected}.x`);
  }
}

function report(rows) {
  const width = Math.max(...rows.map((row) => row.npm.length));
  for (const row of rows) {
    process.stdout.write(
      `${row.npm.padEnd(width)}  ${row.npmVersion.padEnd(8)}  ${row.cargo} ${row.cargoVersion}\n`,
    );
  }
}

function check(pair) {
  const npmVersion = npmResolved(lockfile, pair.npm);
  const cargoVersion = cargoResolved(cargoLockText, pair.cargo);
  const npmMinor = majorMinor(npmVersion);
  const cargoMinor = majorMinor(cargoVersion);

  if (npmMinor === null || cargoMinor === null) {
    problems.push(`  ${pair.npm}: unparseable version (npm ${npmVersion}, cargo ${cargoVersion})`);
  } else if (npmMinor !== cargoMinor) {
    problems.push(
      `  ${pair.npm} (v${npmVersion}) and ${pair.cargo} (v${cargoVersion}) must share a major/minor release`,
    );
  }

  if (cargoMinor !== null) {
    requireMinorLock(
      npmManifest,
      npmDeclared(manifest, pair.npm),
      pair.npm,
      cargoMinor,
    );
    requireMinorLock(cargoManifest, cargoDeclared(cargoManifestText, pair.cargo), pair.cargo, cargoMinor);
  }

  return { npm: pair.npm, npmVersion, cargo: pair.cargo, cargoVersion };
}

const manifest = readJson(npmManifest);
const lockfile = readJson(npmLock);
const cargoManifestText = readFileSync(cargoManifest, "utf8");
const cargoLockText = readFileSync(cargoLock, "utf8");

const rows = pairs.map(check);
rows.push(check(cli));

if (problems.length > 0) {
  process.stderr.write("Tauri npm/cargo pairing failed:\n");
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}

report(rows);
