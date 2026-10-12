import { db, now } from "../lib/db";
import { claimJob, runJob, scheduleDiscovery } from "../lib/worker";
import { randomUUID } from "node:crypto";
const owner = randomUUID();
const acquired = db
  .transaction(() => {
    const old = db
      .prepare("SELECT heartbeat FROM worker_lock WHERE id=1")
      .get() as { heartbeat: number } | undefined;
    if (old && Date.now() - old.heartbeat < 30000) return false;
    db.prepare(
      "INSERT INTO worker_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,heartbeat=excluded.heartbeat",
    ).run(owner, Date.now());
    db.prepare(
      "UPDATE jobs SET status='failed',error='Worker interrupted. Imported evidence and reserved AI costs were preserved; retry from the activity screen.',updated_at=? WHERE status='running'",
    ).run(now());
    return true;
  })
  .immediate();
if (!acquired) {
  console.error("Another ingestion worker is already running.");
  process.exit(1);
}
let stopping = false;
const heartbeat = setInterval(() => {
  const r = db
    .prepare("UPDATE worker_lock SET heartbeat=? WHERE id=1 AND owner=?")
    .run(Date.now(), owner);
  if (!r.changes) stopping = true;
}, 5000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
async function main() {
  console.log("PSX ingestion worker ready");
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
