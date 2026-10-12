import { z } from "zod";
import { today } from "./time";
export const symbols = [
  "OGDC",
  "PPL",
  "POL",
  "FFC",
  "EFERT",
  "LUCK",
  "HUBC",
  "MEBL",
  "MCB",
  "SYS",
] as const;
export const symbolSchema = z.enum(symbols);
export function videoId(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Use a full YouTube video URL");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("Only HTTPS YouTube links are supported");
  const host = u.hostname;
  const id =
    host === "youtu.be"
      ? u.pathname.slice(1)
      : ["www.youtube.com", "youtube.com", "m.youtube.com"].includes(host)
        ? u.searchParams.get("v") ||
          u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1]
        : null;
  if (!id || !/^[-\w]{11}$/.test(id))
    throw new Error("Use a valid YouTube watch, short, or share URL");
  return id;
}
export function officialUrl(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    ![
      "psx.com.pk",
      "www.psx.com.pk",
      "dps.psx.com.pk",
      "financials.psx.com.pk",
    ].includes(u.hostname)
  )
    throw new Error(
      "Classification evidence must link to an official PSX HTTPS page",
    );
  return u.toString();
}
export const importSchema = z
  .object({
    url: z.string().max(300),
    title: z.string().trim().min(1).max(200),
    speaker: z.string().trim().min(1).max(100),
    published_at: z.iso.date(),
    text: z.string().trim().min(20).max(120_000),
    language: z.enum(["ur", "en", "mixed", "unknown"]).default("unknown"),
    source_id: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .refine((v) => v.published_at <= today(), {
    message: "Publication date cannot be in the future",
  });
export const reviewSchema = z
  .object({
    id: z.number().int().positive(),
    symbol: symbolSchema,
    speaker: z.string().trim().min(1).max(100),
    stance: z.enum(["bullish", "bearish", "neutral"]),
    rationale: z.string().trim().min(1).max(2000),
    target: z.string().max(200).nullable(),
    horizon: z.string().max(200).nullable(),
    hypothetical: z.boolean(),
    status: z.enum(["approved", "rejected"]),
    expected_symbol: symbolSchema,
    expected_stance: z.enum(["bullish", "bearish", "neutral"]),
    evaluate: z.boolean(),
  })
  .strict();
export const chatSchema = z
  .object({
    question: z.string().trim().min(3).max(1500),
    symbols: z.array(symbolSchema).max(4),
    since: z.iso.date(),
  })
  .strict();
