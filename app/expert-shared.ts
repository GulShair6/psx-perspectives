import type { ExpertEvidence } from "@/lib/expert";
export type Channel = {
  id: number;
  name: string;
  handle: string | null;
  thumbnail: string | null;
  channel_id: string;
  enabled: number;
  since: string | null;
  until: string | null;
  discovery_complete: number | null;
  paused: number | null;
  discovered: number;
  saved: number;
  indexed: number;
  analyzed: number;
  missing: number;
  last_error: string | null;
};
export type Match = {
  id: string;
  name: string;
  handle: string;
  thumbnail: string;
  url: string;
};
export type Statement = {
  id: number;
  chunk_id: number | null;
  video_id: string;
  quote: string;
  stance: string;
  action: string | null;
  rationale: string;
  target: string | null;
  horizon: string | null;
  attribution: string;
  speaker: string | null;
  status: string;
  validation_error: string | null;
  published_at: string;
  channel: string;
  title: string;
  url: string;
  start_seconds: number | null;
  symbols: string | null;
  topics: string | null;
};
export type Video = {
  id: string;
  title: string;
  published_at: string;
  url: string;
  content_hash: string | null;
  chunk_count: number;
  language: string;
  analysis_status: string | null;
  summary: string | null;
  summary_evidence: string;
  analysis_error: string | null;
  error: string | null;
  accepted_count?: number;
  quarantined_count?: number;
};
export type Claim = { text: string; evidenceIds: string[] };
export type Answer = {
  whatWasSaid: Claim[];
  changes: Claim[];
  disagreements: Claim[];
  interpretation: string;
  gaps: string[];
  evidence: ExpertEvidence[];
  cutoff: string | null;
  coverage?: { discovered: number; indexed: number; missing: number; complete: boolean; cutoff: string | null };
  retrieval?: { method: string; candidateCount: number; selectedCount: number; fallbackReason: string | null };
};
export type Data = {
  channels: Channel[];
  youtubeConfigured: boolean;
  pipeline: { analysis_paused: string | null };
  catalog: { symbol: string; name: string; aliases: string }[];
};
export type Preview = {
  video: { id: string; content_hash: string; title: string; url: string; language: string };
  chunks: { id: number; text: string; start_seconds: number | null; end_seconds: number | null; segmentIds: number[] }[];
  segments: {
    id: number;
    text: string;
    start_seconds: number | null;
    end_seconds: number | null;
    provenance: string;
    retrieved_at: string;
  }[];
};
export const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-GB", {
        timeZone: "Asia/Karachi",
        dateStyle: "medium",
        ...(s.length === 10 ? {} : { timeStyle: "short" as const }),
      })
    : "Unavailable";
export const stamp = (s: number | null) =>
  s === null
    ? "Timestamp unavailable"
    : `${Math.floor(s / 60)}:${Math.floor(s % 60)
        .toString()
        .padStart(2, "0")}`;
export function link(url: string, start: number | null) {
  if (start === null) return url;
  const source = new URL(url);
  source.searchParams.set("t", `${Math.floor(start)}s`);
  return source.toString();
}
export function evidenceText(e: ExpertEvidence) {
  if (/^(statement|opinion):/.test(e.id)) {
    try {
      const content = JSON.parse(e.text);
      if (typeof content.quote === "string") return content.quote;
    } catch {}
  }
  return e.text;
}
export async function api<T>(path: string, payload?: unknown): Promise<T> {
  const r = await fetch(
    "/api/" + path,
    payload === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
