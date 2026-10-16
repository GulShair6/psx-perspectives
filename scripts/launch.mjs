import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const production = process.argv.includes("--production");
const env = [".env", ".env.local"]
  .filter((file) => existsSync(file))
  .map((file) => `--env-file=${file}`);
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
const localPython = resolve("data/local-translation/venv/bin/python");
let localRuntime;
if (
  existsSync(localPython) &&
  existsSync("data/local-translation/installed.json")
) {
  const localEnv = { ...process.env };
  for (const key of Object.keys(localEnv))
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)) delete localEnv[key];
  localRuntime = spawn(localPython, [resolve("local_translation/runtime.py")], {
    stdio: ["ignore", "ignore", "inherit"],
    env: localEnv,
  });
  localRuntime.on("error", () =>
    console.error(
      "Local translation runtime could not start; saved captions remain available.",
    ),
  );
}
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  localRuntime?.kill("SIGTERM");
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 6000).unref();
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
