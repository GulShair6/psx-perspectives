import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-local-ipc-"));
process.env.PSX_LOCAL_TRANSLATION_DIR = temp;
const { inferLocal, localRequest, localReadiness, LOCAL_VERSION } =
  await import("../lib/local-runtime");
test("private local IPC preserves split Urdu bytes and redacts error credentials", async () => {
  process.env.HF_TOKEN = "synthetic-ipc-secret";
  const server = createServer((socket) => {
    let request = "";
    socket.on("data", (data) => {
      request += data.toString();
      if (!request.endsWith("\n")) return;
      const p = JSON.parse(request);
      assert.ok(p.deadline > Date.now());
      const response = Buffer.from(
        JSON.stringify(
          p.operation === "error"
            ? { error: "synthetic-ipc-secret" }
            : { blocks: [{ id: 1, text: "100 پر نہ خریدیں" }] },
        ),
      );
      const split = response.indexOf(Buffer.from("پر")) + 1;
      socket.write(response.subarray(0, split));
      setTimeout(() => socket.end(response.subarray(split)), 5);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(join(temp, "runtime.sock"), resolve),
  );
  try {
    writeFileSync(
      join(temp, "installed.json"),
      readFileSync("local_translation/models.json"),
    );
    const state = {
      pid: process.pid,
      owner: "test-runtime",
      version: LOCAL_VERSION,
      heartbeat: Date.now(),
    };
    assert.equal(
      localReadiness().ready,
      false,
      "A socket alone is insufficient",
    );
    writeFileSync(join(temp, "runtime.json"), JSON.stringify(state));
    assert.equal(
      localReadiness().ready,
      true,
      "Busy runtime needs no status request",
    );
    writeFileSync(
      join(temp, "runtime.json"),
      JSON.stringify({ ...state, heartbeat: Date.now() - 31000 }),
    );
    assert.equal(localReadiness().ready, false);
    writeFileSync(
      join(temp, "runtime.json"),
      JSON.stringify({ ...state, pid: 2147483647 }),
    );
    assert.equal(
      localReadiness().ready,
      false,
      "A dead process cannot be ready",
    );
    const rows = await inferLocal("hi", "ur", [
      { id: 1, text: "खरीदो मत 100" },
    ]);
    assert.equal(rows[0].text, "100 پر نہ خریدیں");
    await assert.rejects(
      localRequest({ operation: "error" }),
      (e) =>
        e instanceof Error &&
        e.message.includes("[credential redacted]") &&
        !e.message.includes("synthetic-ipc-secret"),
    );
  } finally {
    delete process.env.HF_TOKEN;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(temp, { recursive: true, force: true });
  }
});
