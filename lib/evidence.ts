import { z } from "zod";
import { db } from "./db";
export const EXTRACTION_VERSION = "expert-2";
export type SourceSegment = {
  id: number;
  ordinal: number;
  text: string;
  start_seconds: number | null;
  end_seconds: number | null;
};
export function sourceSegments(chunkId: number): SourceSegment[] {
  return db.prepare("SELECT s.id,s.ordinal,s.text,s.start_seconds,s.end_seconds FROM chunk_segments cs JOIN caption_segments s ON s.id=cs.segment_id JOIN chunks c ON c.id=cs.chunk_id WHERE cs.chunk_id=? AND s.video_id=c.video_id ORDER BY s.ordinal").all(chunkId) as SourceSegment[];
}
export function reconstructQuote(raw: unknown, chunks: {
  id: number;
}[]) {
  const selection = z.object({
    chunk_id: z.number().int(),
    start_segment_id: z.number().int(),
    end_segment_id: z.number().int(),
  }).parse(raw);
  if (!chunks.some((c) => c.id === selection.chunk_id))
    throw new Error("Selected chunk is outside the supplied batch");
  const segments = sourceSegments(selection.chunk_id);
  const first = segments.findIndex((s) => s.id === selection.start_segment_id);
  const last = segments.findIndex((s) => s.id === selection.end_segment_id);
  if (first < 0 || last < first)
    throw new Error("Selected segment range is invalid or outside the chunk");
  const span = segments.slice(first, last + 1);
  if (span.some((s, i) => i > 0 && s.ordinal !== span[i - 1].ordinal + 1))
    throw new Error("Selected segments are not contiguous");
  return {
    ...(raw as Record<string, unknown>),
    ...selection,
    quote: span.map((s) => s.text).join(" "),
    start_seconds: span[0].start_seconds,
    end_seconds: span.at(-1)!.end_seconds,
  };
}
// Reviewed decisions survive reanalysis; automatic rows switch only after a successful run.
export const activeStatementSql = `st.status IN ('unreviewed','reviewed') AND (
 st.status='reviewed' OR (
  st.transcript_hash=(SELECT content_hash FROM videos WHERE id=st.video_id)
  AND ((st.analysis_version='${EXTRACTION_VERSION}' AND EXISTS(
   SELECT 1 FROM analysis_runs ar WHERE ar.video_id=st.video_id AND ar.transcript_hash=st.transcript_hash AND ar.version='${EXTRACTION_VERSION}' AND ar.status='done')) OR
   (st.analysis_version!='${EXTRACTION_VERSION}' AND NOT EXISTS(
   SELECT 1 FROM analysis_runs ar WHERE ar.video_id=st.video_id AND ar.transcript_hash=st.transcript_hash AND ar.version='${EXTRACTION_VERSION}' AND ar.status='done')))
  AND NOT EXISTS(SELECT 1 FROM statements decision WHERE decision.video_id=st.video_id AND (instr(decision.quote,st.quote)>0 OR instr(st.quote,decision.quote)>0) AND decision.status IN ('reviewed','rejected'))
 )
)`;
