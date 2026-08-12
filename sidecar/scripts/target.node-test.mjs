import assert from "node:assert/strict";
import test from "node:test";
import { selectBuildTarget, targetForTriple } from "./target.mjs";

test("maps Tauri triples to pkg targets and externalBin filenames", () => {
  const expected = [
    ["x86_64-unknown-linux-gnu", "node22-linux-x64", ""],
    ["aarch64-unknown-linux-gnu", "node22-linux-arm64", ""],
    ["x86_64-apple-darwin", "node22-macos-x64", ""],
    ["aarch64-apple-darwin", "node22-macos-arm64", ""],
    ["x86_64-pc-windows-msvc", "node22-win-x64", ".exe"],
    ["aarch64-pc-windows-msvc", "node22-win-arm64", ".exe"],
  ];

  for (const [triple, pkgTarget, executableSuffix] of expected) {
    assert.deepEqual(targetForTriple(triple), {
      triple,
      pkgTarget,
      executableSuffix,
    });
  }
});

test("rejects targets without a native pkg contract", () => {
  assert.throws(
    () => targetForTriple("wasm32-unknown-unknown"),
    /Unsupported sidecar target/,
  );
});

test("uses the host only as a local fallback and rejects cross-target output", () => {
  const host = "x86_64-unknown-linux-gnu";
  assert.equal(selectBuildTarget(undefined, host).triple, host);
  assert.equal(selectBuildTarget(host, host).triple, host);
  assert.throws(
    () => selectBuildTarget("aarch64-unknown-linux-gnu", host),
    /Cross-target sidecar packaging is disabled/,
  );
});
