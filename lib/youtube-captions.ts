import {
  YoutubeTranscript,
  YoutubeTranscriptTooManyRequestError,
} from "youtube-transcript";

export function normalizeCaptions(
  segments: { text: string; offset: number; duration: number; lang?: string }[],
  milliseconds: boolean,
) {
  return segments.map((s) => ({
    ...s,
    offset: s.offset / (milliseconds ? 1000 : 1),
    duration: s.duration / (milliseconds ? 1000 : 1),
  }));
}
export type CaptionCue = {
  id: number;
  text: string;
  startSeconds: number;
  endSeconds: number;
};
type Track = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
};

function arrayMetadata(body: string, name: string) {
  const at = body.indexOf(`"${name}":`);
  if (at < 0) return null;
  const begin = body.indexOf("[", at + name.length + 3);
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let end = begin; begin >= 0 && end < body.length; end++) {
    const c = body[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === "[") depth++;
      if (c === "]" && --depth === 0)
        return { begin, end, value: JSON.parse(body.slice(begin, end + 1)) };
    }
  }
  throw new Error("Malformed YouTube caption metadata");
}

export async function captions(
  id: string,
  target?: "ur" | "en",
  hint?: string,
) {
  let milliseconds = false;
  let blocked = false;
  let provenance = "YouTube captions (track provenance unavailable)";
  let expectedCues: number | null = null;
  let preferred: Track | undefined;
  let failure: Error | null = null;
  const segments = await YoutubeTranscript.fetchTranscript(id, {
    fetch: async (input, init) => {
      if (failure) throw failure;
      try {
        if (blocked) throw new YoutubeTranscriptTooManyRequestError();
        const u = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.port ||
          !["www.youtube.com", "youtube.com"].includes(u.hostname)
        )
          throw new Error("Unsupported caption host");
        if (preferred && u.pathname.includes("timedtext")) {
          const selected = new URL(preferred.baseUrl);
          if (
            selected.protocol !== "https:" ||
            !["www.youtube.com", "youtube.com"].includes(selected.hostname) ||
            selected.port ||
            selected.username ||
            selected.password
          )
            throw new Error("Unsupported caption track host");
          if (target && preferred.languageCode.split("-")[0] !== target)
            selected.searchParams.set("tlang", target);
          input = selected.href;
        }
        const response = await fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429 || response.status === 403) {
          blocked = true;
          throw new YoutubeTranscriptTooManyRequestError();
        }
        if (target && !response.ok)
          throw new Error(
            `YouTube captions unavailable (HTTP ${response.status})`,
          );
        let body = await response.text();
        if (Buffer.byteLength(body) > 3_000_000)
          throw new Error("Caption response exceeds size limit");
        if (target && u.pathname === "/youtubei/v1/player") JSON.parse(body);
        if (target && u.pathname.includes("timedtext")) {
          if (
            !/^(?:<\?xml[\s\S]*?\?>\s*)?<(transcript|timedtext)\b[^>]*>[\s\S]*<\/\1>\s*$/.test(
              body.trim(),
            )
          )
            throw new Error("YouTube returned malformed or truncated captions");
          expectedCues = (body.match(/<(?:text|p)(?=[\s>])/g) || []).length;
        }
        const metadata = arrayMetadata(body, "captionTracks");
        if (metadata) {
          const { begin, end } = metadata;
          try {
            let tracks = metadata.value as Track[];
            tracks.sort(
              (a, b) =>
                Number(a.kind === "asr") - Number(b.kind === "asr") ||
                Number(!["ur", "en"].includes(a.languageCode)) -
                  Number(!["ur", "en"].includes(b.languageCode)),
            );
            if (target) {
              preferred = tracks.find(
                (t) => t.languageCode.split("-")[0] === target,
              );
              if (!preferred) {
                const languages = arrayMetadata(body, "translationLanguages")
                  ?.value as { languageCode: string }[] | undefined;
                if (
                  languages &&
                  !languages.some((l) => l.languageCode === target)
                )
                  throw new Error(
                    "YouTube does not offer this translation language",
                  );
                preferred = tracks
                  .filter((t) => t.isTranslatable === true)
                  .sort(
                    (a, b) =>
                      Number(b.languageCode === hint) -
                      Number(a.languageCode === hint),
                  )[0];
                if (!preferred)
                  throw new Error(
                    "YouTube does not offer translatable captions for this video",
                  );
              }
              tracks = [preferred];
              const selected = new URL(preferred.baseUrl);
              if (
                selected.protocol !== "https:" ||
                selected.username ||
                selected.password ||
                selected.port ||
                !["www.youtube.com", "youtube.com"].includes(selected.hostname)
              )
                throw new Error("Unsupported caption track host");
            } else preferred = tracks[0];
            if (preferred)
              provenance =
                preferred.kind === "asr"
                  ? "YouTube automatic captions"
                  : "YouTube creator-supplied captions";
            if (target && preferred?.languageCode.split("-")[0] !== target)
              provenance = "YouTube auto-translation";
            body =
              body.slice(0, begin) +
              JSON.stringify(tracks) +
              body.slice(end + 1);
          } catch (error) {
            if (target) throw error;
            /* Metadata unavailable; keep original response. */
          }
        }
        if (/<p\s+t="\d+"\s+d="\d+"/.test(body)) milliseconds = true;
        return new Response(body, {
          status: response.status,
          headers: response.headers,
        });
      } catch (error) {
        if (target)
          failure =
            error instanceof Error
              ? error
              : new Error("YouTube captions unavailable");
        throw error;
      }
    },
  }).catch((error) => {
    throw failure || error;
  });
  if (target && !preferred)
    throw new Error("YouTube caption language metadata is unavailable");
  if (expectedCues !== null && segments.length !== expectedCues)
    throw new Error("YouTube returned malformed or empty caption cues");
  if (!segments.length)
    throw new Error("No usable captions; import TXT/SRT/VTT instead");
  return normalizeCaptions(segments, milliseconds).map((s) => ({
    ...s,
    lang: preferred?.languageCode || s.lang,
    provenance,
  }));
}

export async function youtubeCaptions(
  id: string,
  target: "ur" | "en",
  hint: string,
) {
  const segments = await captions(id, target, hint);
  let previous = -1;
  const cues: CaptionCue[] = segments.map((s, id) => {
    const text = s.text.trim(),
      startSeconds = s.offset,
      endSeconds = s.offset + s.duration;
    if (
      !text ||
      text.length > 32000 ||
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      startSeconds < previous ||
      endSeconds <= startSeconds
    )
      throw new Error("YouTube returned malformed caption text or timestamps");
    previous = startSeconds;
    return { id, text, startSeconds, endSeconds };
  });
  return {
    sourceLanguage: segments[0].lang || hint,
    provenance: segments[0].provenance,
    cues,
  };
}
