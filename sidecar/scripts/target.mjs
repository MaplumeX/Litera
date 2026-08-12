import { execFileSync } from "node:child_process";

const TARGETS = new Map([
  ["x86_64-unknown-linux-gnu", "node22-linux-x64"],
  ["aarch64-unknown-linux-gnu", "node22-linux-arm64"],
  ["x86_64-apple-darwin", "node22-macos-x64"],
  ["aarch64-apple-darwin", "node22-macos-arm64"],
  ["x86_64-pc-windows-msvc", "node22-win-x64"],
  ["aarch64-pc-windows-msvc", "node22-win-arm64"],
]);

function cliTarget() {
  const index = process.argv.indexOf("--target");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--target requires a Rust target triple");
  }
  return value;
}

export function targetForTriple(triple) {
  const pkgTarget = TARGETS.get(triple);
  if (!pkgTarget) {
    throw new Error(
      `Unsupported sidecar target '${triple}'. Build on a supported native Tauri target: ${[...TARGETS.keys()].join(", ")}`,
    );
  }
  return {
    triple,
    pkgTarget,
    executableSuffix: triple.includes("windows") ? ".exe" : "",
  };
}

export function selectBuildTarget(requested, host) {
  const triple = requested ?? host;
  const target = targetForTriple(triple);
  if (requested && triple !== host) {
    throw new Error(
      `Cross-target sidecar packaging is disabled (${host} -> ${triple}); run the build on the target OS/architecture CI runner`,
    );
  }
  return target;
}

export function resolveTarget() {
  const requested =
    cliTarget()
    ?? process.env.TAURI_TARGET_TRIPLE
    ?? process.env.TAURI_ENV_TARGET_TRIPLE
    ?? process.env.CARGO_BUILD_TARGET;
  let hostOutput;
  try {
    hostOutput = execFileSync("rustc", ["--print", "host-tuple"], {
      encoding: "utf8",
    });
  } catch (error) {
    // Some filesystem sandboxes report EPERM after rustup successfully exits.
    // Only accept that case when rustc produced a complete host tuple.
    if (error && typeof error === "object" && "stdout" in error && error.stdout) {
      hostOutput = String(error.stdout);
    } else {
      throw error;
    }
  }
  const host = hostOutput.trim();
  return selectBuildTarget(requested, host);
}
