import { db, now } from "./db";

export function acquireWorker(owner: string, timestamp = Date.now()) {
  return db
    .transaction(() => {
      const old = db
        .prepare("SELECT heartbeat FROM worker_lock WHERE id=1")
        .get() as { heartbeat: number } | undefined;
      if (old && timestamp - old.heartbeat < 30_000) return false;
      db.prepare(
        "INSERT INTO worker_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,heartbeat=excluded.heartbeat",
      ).run(owner, timestamp);
      db.prepare(
        "UPDATE jobs SET status='failed',error='Worker interrupted. Imported evidence was preserved; retry from the activity screen.',updated_at=? WHERE status='running'",
      ).run(now());
      db.prepare(
        "UPDATE analysis_runs SET status='failed',error='Worker interrupted; resume cloud analysis to retry with cached statements preserved' WHERE status='pending' AND EXISTS(SELECT 1 FROM jobs WHERE type='insights' AND status='failed' AND json_extract(payload,'$.id')=analysis_runs.video_id)",
      ).run();
      return true;
    })
    .immediate();
}
