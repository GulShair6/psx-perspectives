import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
test("launcher loads .env then .env.local for both processes, preserving inherited values", () => {
  const root = mkdtempSync(join(tmpdir(), "psx-env-"));
  try {
    mkdirSync(join(root, "node_modules/next/dist/bin"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    symlinkSync(
      resolve("node_modules/tsx"),
      join(root, "node_modules/tsx"),
      "dir",
    );
    const fixture =
      'console.log("ENV_CHECK:"+process.env.PSX_ENV_TEST);setTimeout(()=>{},1200);';
    writeFileSync(join(root, "node_modules/next/dist/bin/next"), fixture);
    writeFileSync(join(root, "scripts/worker.ts"), fixture);
    writeFileSync(join(root, ".env"), "PSX_ENV_TEST=base\n");
    writeFileSync(join(root, ".env.local"), "PSX_ENV_TEST=local\n");
    for (const inherited of [undefined, "inherited"]) {
      const env = { ...process.env };
      delete env.PSX_ENV_TEST;
      if (inherited) env.PSX_ENV_TEST = inherited;
      const r = spawnSync(process.execPath, [resolve("scripts/launch.mjs")], {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 15000,
      });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.stdout.trim().split("\n"), [
        `ENV_CHECK:${inherited || "local"}`,
        `ENV_CHECK:${inherited || "local"}`,
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("secret environment files are ignored and the example contains no credential", () => {
  const r = spawnSync("git", ["check-ignore", ".env", ".env.local"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split("\n"), [".env", ".env.local"]);
  assert.match(readFileSync(".env.example", "utf8"), /^OLLAMA_API_KEY=$/m);
});
