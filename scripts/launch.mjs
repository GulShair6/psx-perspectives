import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const production = process.argv.includes("--production");
const env = existsSync(".env.local") ? ["--env-file=.env.local"] : [];
const children = [
  spawn(
    process.execPath,
    [
      ...env,
      "node_modules/next/dist/bin/next",
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
    ],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [...env, "--import", "tsx", resolve("scripts/worker.ts")],
    { stdio: "inherit" },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 6000).unref();
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
