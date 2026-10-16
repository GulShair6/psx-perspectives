import { db, now } from "../lib/db";
import { claimJob, runJob, scheduleDiscovery } from "../lib/worker";
import { aiSettings } from "../lib/ai";
import { randomUUID } from "node:crypto";
import { acquireWorker } from "../lib/worker-lease";
const owner = randomUUID();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
let acquired = acquireWorker(owner);
const deadline = Date.now() + 35_000;
if (!acquired) console.log("Waiting for the previous worker lease to clear…");
while (!acquired && !stopping && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!stopping) acquired = acquireWorker(owner);
}
if (!acquired) {
  if (!stopping) console.error("Another ingestion worker is already running.");
  db.close();
  process.exit(stopping ? 0 : 1);
}
const heartbeat = setInterval(() => {
  const r = db
    .prepare("UPDATE worker_lock SET heartbeat=? WHERE id=1 AND owner=?")
    .run(Date.now(), owner);
  if (!r.changes) stopping = true;
}, 5000);
async function main() {
  const ai = aiSettings();
  console.log(
    `PSX ingestion worker ready; ${ai.provider} ${ai.configured ? "configured" : "not configured"}`,
  );
  let nextScan = 0;
  while (!stopping) {
    if (Date.now() >= nextScan) {
      scheduleDiscovery();
      nextScan = Date.now() + 15_000;
    }
    const j = claimJob();
    if (!j) {
      await new Promise((r) => setTimeout(r, 750));
      continue;
    }
    try {
      const result = await runJob(j);
      db.prepare(
        "UPDATE jobs SET status='done',progress=?,updated_at=? WHERE id=?",
      ).run(result, now(), j.id);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      db.prepare(
        "UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",
      ).run(error, now(), j.id);
      console.error(`Job ${j.id}: ${error}`);
    }
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(heartbeat);
    db.prepare("DELETE FROM worker_lock WHERE owner=?").run(owner);
    db.close();
  });
