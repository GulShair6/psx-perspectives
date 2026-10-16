import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "psx-local-ipc-"));
process.env.PSX_LOCAL_TRANSLATION_DIR = temp;
const { inferLocal, localRequest } = await import("../lib/local-runtime");
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
