import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { z } from "zod";
import models from "../local_translation/models.json";

export const LOCAL_VERSION = "local-1";
export const LOCAL_REVISION = createHash("sha256")
  .update(JSON.stringify(models))
  .digest("hex");
export const localDirectory = join(process.cwd(), "data/local-translation");
export const sourceHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function localReadiness() {
  try {
    const installed = JSON.parse(
      readFileSync(join(localDirectory, "installed.json"), "utf8"),
    );
    if (JSON.stringify(installed) !== JSON.stringify(models))
      throw new Error("Pinned model revisions differ");
    if (!existsSync(join(localDirectory, "runtime.sock")))
      return {
        ready: false,
        reason:
          "Local translation runtime is stopped. Start the local Python runtime; saved translations remain readable.",
      };
    return { ready: true, reason: null };
  } catch {
    return {
      ready: false,
      reason:
        "Local models are not installed. Run the local translation setup after freeing 8 GiB and granting model access. No cloud translation was requested.",
    };
  }
}
export function sourceLanguage(text: string, hint: string) {
  const deva = (text.match(/\p{Script=Devanagari}/gu) || []).length;
  const arabic = (text.match(/\p{Script=Arabic}/gu) || []).length;
  const guru = (text.match(/\p{Script=Gurmukhi}/gu) || []).length;
  if ([deva, arabic, guru].filter((n) => n > 0).length > 1)
    throw new Error(
      "Mixed Indic scripts need an explicit source correction before local translation. Use the original or explicit Ollama fallback.",
    );
  if (deva) return "hi" as const;
  if (guru) return "pa" as const;
  if (arabic && ["ur", "hi", "unknown", ""].includes(hint.split("-")[0]))
    return "ur" as const;
  if (
    !deva &&
    !arabic &&
    !guru &&
    /^en(?:-|$)/.test(hint) &&
    !/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(text)
  )
    return "en" as const;
  throw new Error(
    "Unsupported or uncertain source language/script. Roman Urdu and Punjabi Shahmukhi are not supported locally; correct source metadata or use explicit Ollama fallback.",
  );
}
export type LocalBlock = { id: number; text: string };
const numeric = (text: string) =>
  (text.match(/[+\-−]?\p{Nd}+(?:[.,]\p{Nd}+)*(?:[%٪])?/gu) || []).sort();
export function validateLocalBlocks(input: LocalBlock[], raw: unknown) {
  const out = z
    .array(
      z
        .object({
          id: z.number().int(),
          text: z.string().trim().min(1).max(100000),
        })
        .strict(),
    )
    .parse(raw);
  if (
    out.length !== input.length ||
    new Set(out.map((b) => b.id)).size !== input.length ||
    out.some((b) => !input.some((i) => i.id === b.id))
  )
    throw new Error(
      "Local translation returned an incomplete or invalid block mapping",
    );
  for (const row of out) {
    const original = input.find((b) => b.id === row.id)!;
    if (
      row.text.length > Math.max(2048, original.text.length * 12) ||
      JSON.stringify(numeric(row.text)) !==
        JSON.stringify(numeric(original.text))
    )
      throw new Error(
        "Local translation changed numerical notation or exceeded output bounds; original retained",
      );
  }
  return out;
}
export function localRequest(
  payload: unknown,
  timeout = 15 * 60_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(localDirectory, "runtime.sock"));
    let text = "";
    const fail = () => {
      socket.destroy();
      reject(
        new Error(
          "Local runtime unavailable, busy or interrupted. Saved text is retained; retry when ready.",
        ),
      );
    };
    socket.setTimeout(timeout, fail);
    socket.on("error", fail);
    socket.on("connect", () => socket.end(JSON.stringify(payload) + "\n"));
    socket.on("data", (data) => {
      text += data.toString();
      if (Buffer.byteLength(text) > 2_000_000) fail();
    });
    socket.on("end", () => {
      try {
        const parsed = JSON.parse(text);
        if (parsed.error)
          throw new Error(
            typeof parsed.error === "string"
              ? parsed.error
              : "Local translation failed",
          );
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}
export async function inferLocal(
  source: string,
  target: "ur" | "en",
  blocks: LocalBlock[],
  timeout?: number,
) {
  const raw = (await localRequest({ source, target, blocks }, timeout)) as {
    blocks?: unknown;
  };
  return validateLocalBlocks(blocks, raw.blocks);
}
