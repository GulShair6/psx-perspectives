import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
const temp = mkdtempSync(join(tmpdir(), "psx-lease-"));
process.env.PSX_DB_PATH = join(temp, "db.sqlite");
const { db, now } = await import("../lib/db");
const { acquireWorker } = await import("../lib/worker-lease");
test("leases cannot be stolen while fresh and interrupted work is retained", () => {
  db.prepare(
    "INSERT INTO jobs(type,payload,status,created_at,updated_at) VALUES('fixture','{}','running',?,?)",
  ).run(now(), now());
  db.prepare("INSERT INTO worker_lock VALUES(1,'old',1000)").run();
  assert.equal(acquireWorker("replacement", 30999), false);
  assert.equal(acquireWorker("replacement", 31000), true);
  assert.equal(acquireWorker("competitor", 31001), false);
  assert.equal(
    (db.prepare("SELECT status FROM jobs").get() as { status: string }).status,
    "failed",
  );
  assert.equal(
    (db.prepare("SELECT owner FROM worker_lock").get() as { owner: string })
      .owner,
    "replacement",
  );
  db.exec(
    "DELETE FROM jobs; DELETE FROM worker_lock; UPDATE sources SET enabled=0",
  );
});
test("worker waits through a dead lease and termination while waiting preserves its owner", async () => {
  const env = {
    ...process.env,
    OLLAMA_API_KEY: "",
    OPENAI_API_KEY: "",
    YOUTUBE_DATA_API_KEY: "",
  };
  const start = () =>
    spawn(process.execPath, ["--import", "tsx", resolve("scripts/worker.ts")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  db.prepare("INSERT INTO worker_lock VALUES(1,'dead',?)").run(
    Date.now() - 29000,
  );
  const child = start();
  const exit = once(child, "exit");
  let output = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(output || "Worker did not restart")),
        15000,
      );
      child.stdout.on("data", (b) => {
        output += b;
        if (output.includes("worker ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(output));
      });
    });
    assert.match(output, /worker ready/);
  } finally {
    child.kill("SIGTERM");
    await exit;
  }
  db.prepare("INSERT OR REPLACE INTO worker_lock VALUES(1,'live',?)").run(
    Date.now(),
  );
  const waiting = start();
  const ended = once(waiting, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No waiting status")),
        10000,
      );
      waiting.stdout.on("data", (b) => {
        if (String(b).includes("Waiting")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  } finally {
    waiting.kill("SIGTERM");
    await ended;
  }
  assert.equal(
    (db.prepare("SELECT owner FROM worker_lock").get() as { owner: string })
      .owner,
    "live",
  );
});
test.after(() => {
  db.close();
  rmSync(temp, { recursive: true, force: true });
});
