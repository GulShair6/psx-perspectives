import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
  readdirSync,
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
      'const fs=require("node:fs");console.log("ENV_CHECK:"+process.env.PSX_ENV_TEST);fs.writeFileSync("ready-"+process.pid,"");const t=setInterval(()=>{if(fs.readdirSync(".").filter(x=>x.startsWith("ready-")).length===2){clearInterval(t);setTimeout(()=>{},200);}},50);';
    writeFileSync(join(root, "node_modules/next/dist/bin/next"), fixture);
    writeFileSync(join(root, "scripts/worker.ts"), fixture);
    const formerRuntime = join(root, "data/local-translation");
    mkdirSync(join(formerRuntime, "venv/bin"), { recursive: true });
    writeFileSync(join(formerRuntime, "installed.json"), "{}");
    writeFileSync(
      join(formerRuntime, "venv/bin/python"),
      "#!/bin/sh\nprintf launched > python-launched\n",
      { mode: 0o755 },
    );
    writeFileSync(join(root, ".env"), "PSX_ENV_TEST=base\n");
    writeFileSync(join(root, ".env.local"), "PSX_ENV_TEST=local\n");
    for (const inherited of [undefined, "inherited"]) {
      for (const name of readdirSync(root).filter((x) =>
        x.startsWith("ready-"),
      ))
        rmSync(join(root, name));
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
      assert.ok(
        !readdirSync(root).includes("python-launched"),
        "Retired installed models must not be launched",
      );
      assert.deepEqual(r.stdout.trim().split("\n"), [
        `ENV_CHECK:${inherited || "local"}`,
        `ENV_CHECK:${inherited || "local"}`,
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("private environment and SQLite files are ignored and the example contains no credential", () => {
  const privateFiles = [
    ".env",
    ".env.local",
    "research.sqlite",
    "research.sqlite-wal",
    "research.sqlite-shm",
  ];
  const r = spawnSync("git", ["check-ignore", ...privateFiles], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split("\n"), privateFiles);
  assert.match(readFileSync(".env.example", "utf8"), /^OLLAMA_API_KEY=$/m);
  const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  assert.equal(tracked.status, 0, tracked.stderr);
  const privatePaths = tracked.stdout
    .split("\0")
    .filter(
      (path) =>
        path !== ".env.example" &&
        /(^|\/)(\.env(?:\.|$)|\.aws\/|data\/)|\.(?:sqlite(?:-wal|-shm)?|pem|key)$/.test(
          path,
        ),
    );
  assert.deepEqual(privatePaths, [], "Private files must not be tracked");
});
