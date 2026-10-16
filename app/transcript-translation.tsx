"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TranslationState } from "@/lib/translations";
import { api, date, link, stamp, type Preview } from "./expert-shared";
import { PageControls, ReadableError } from "./research-ui";

export default function TranscriptTranslation({
  video,
  segments,
  full = false,
}: {
  video: Preview["video"];
  segments: Preview["segments"];
  full?: boolean;
}) {
  const ids = segments.map((s) => s.id).join(",");
  const scope = `${video.id}:${video.content_hash}:${full ? "all" : ids}`;
  const [target, setTarget] = useState<"ur" | "en" | null>(null);
  const [method, setMethod] = useState<"youtube" | "ollama">("youtube");
  const [result, setResult] = useState<{
    scope: string;
    value: TranslationState;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const serial = useRef(0);
  const data =
    result?.scope === scope &&
    result.value.target === target &&
    result.value.method === method
      ? result.value
      : null;
  const pending =
    !!data?.job &&
    ["queued", "running"].includes(data.job.status) &&
    !data.complete;
  const query = `translations?videoId=${encodeURIComponent(video.id)}&target=${target || "ur"}&method=${method}${full ? "" : `&segmentIds=${encodeURIComponent(ids)}`}`;
  useEffect(() => {
    serial.current++;
    setTarget(null);
    setMethod("youtube");
    setResult(null);
    setError("");
    setBusy(false);
    setPage(0);
    return () => {
      serial.current++;
    };
  }, [scope]);

  const accept = useCallback(
    (value: TranslationState, request: number) => {
      if (value.transcriptHash !== video.content_hash)
        throw new Error(
          "The saved transcript changed. Close and reopen this panel to translate it.",
        );
      if (serial.current === request) setResult({ scope, value });
    },
    [scope, video.content_hash],
  );
  async function translate(
    language: "ur" | "en",
    source: "youtube" | "ollama" = "youtube",
  ) {
    const request = ++serial.current;
    const current = () => serial.current === request;
    setTarget(language);
    setMethod(source);
    setBusy(true);
    setError("");
    const path = `translations?videoId=${encodeURIComponent(video.id)}&target=${language}&method=${source}${full ? "" : `&segmentIds=${encodeURIComponent(ids)}`}`;
    try {
      let state = await api<TranslationState>(path);
      accept(state, request);
      if (
        !state.complete &&
        !["queued", "running"].includes(state.job?.status || "") &&
        state.available
      ) {
        await api("translations", {
          videoId: video.id,
          target: language,
          method: source,
          ...(full ? {} : { segmentIds: segments.map((s) => s.id) }),
        });
        if (!current()) return;
        state = await api<TranslationState>(path);
        if (current()) accept(state, request);
      }
    } catch (e) {
      if (current())
        setError(e instanceof Error ? e.message : "Translation request failed");
    } finally {
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    if (!pending || busy) return;
    const request = serial.current;
    let canceled = false,
      loading = false;
    const timer = setInterval(async () => {
      if (loading) return;
      loading = true;
      try {
        const state = await api<TranslationState>(query);
        if (!canceled && serial.current === request) {
          accept(state, request);
          setError("");
        }
      } catch (e) {
        if (!canceled && serial.current === request)
          setError(
            e instanceof Error
              ? e.message
              : "Could not refresh translation progress",
          );
      } finally {
        loading = false;
      }
    }, 2000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [pending, query, accept, busy]);

  const cached = new Map(
    data?.translations.map((row) => [row.segmentId, row]) || [],
  );
  const visible = full ? segments.slice(page * 25, (page + 1) * 25) : segments;
  const youtube = !!target && method === "youtube";
  const groups = full && !youtube ? visible.map((s) => [s]) : [visible];
  const visibleCues =
    data?.captionTrack?.cues.filter((cue) =>
      visible.some(
        (s) =>
          s.start_seconds !== null &&
          s.end_seconds !== null &&
          cue.startSeconds < s.end_seconds &&
          cue.endSeconds > s.start_seconds,
      ),
    ) || [];
  const noVisibleCues =
    youtube && !!data?.complete && !!visible.length && !visibleCues.length;
  const count = data?.translations.length || 0;
  const unavailable =
    !busy && !!(error || noVisibleCues || (data && !data.complete && !pending));
  return (
    <section
      className="transcript-translation"
      aria-label="Transcript translation"
    >
      <div
        className="expert-actions"
        role="group"
        aria-label="Translation language"
      >
        <button
          type="button"
          disabled={busy || !segments.length}
          aria-pressed={target === "ur"}
          onClick={() => void translate("ur")}
        >
          Translate to Urdu
        </button>
        <button
          type="button"
          disabled={busy || !segments.length}
          aria-pressed={target === "en"}
          onClick={() => void translate("en")}
        >
          Translate to English
        </button>
      </div>
      {target && (
        <>
          <p className="source-meta">
            {method === "ollama"
              ? "Ollama AI translation"
              : data?.captionTrack?.provenance || "YouTube captions"}{" "}
            — not independently reviewed
          </p>
          <p role="status">
            {busy
              ? "Loading saved translation…"
              : youtube
                ? data?.complete
                  ? "YouTube captions ready · no Ollama quota used"
                  : pending
                    ? data?.job?.status === "queued"
                      ? "Queued for YouTube captions."
                      : "Retrieving YouTube captions…"
                    : "YouTube captions unavailable."
                : data?.complete
                  ? `Translation completed · ${count}/${data.total} segments`
                  : `${count ? `Partially translated · ${count}/${data?.total} segments. ` : ""}${data?.job?.status === "running" ? "Translating…" : data?.job?.status === "queued" ? "Queued for translation." : data?.job?.status === "failed" ? "Translation failed." : "Translation incomplete."}`}
          </p>
          {data && !data.complete && !data.workerOnline && (
            <p role="status">
              The ingestion worker is offline. Start the app and worker to
              continue queued translations.
            </p>
          )}
          {data && !data.complete && data.unavailableReason && (
            <p role="status">{data.unavailableReason}</p>
          )}
          {(error || (!data?.complete && data?.job?.error)) && (
            <div role="alert">
              <ReadableError
                message={error || data?.job?.error || "Translation failed"}
              />
            </div>
          )}
          {data?.numberWarning && (
            <p role="alert">
              Numbers or their formatting differ from the saved original. Check
              the original caption or audio before relying on these captions.
            </p>
          )}
          {unavailable &&
            !noVisibleCues &&
            (!youtube || data?.available !== false) && (
              <button
                type="button"
                onClick={() => void translate(target, method)}
              >
                {youtube ? "Retry YouTube captions" : "Retry translation"}
              </button>
            )}
          {unavailable && youtube && (
            <div>
              <p className="source-meta">
                Ollama Cloud uses cloud quota for missing translations.
                Previously saved Ollama translations are reused.
              </p>
              <button
                type="button"
                onClick={() => void translate(target, "ollama")}
              >
                Use Ollama Cloud
              </button>
            </div>
          )}
        </>
      )}
      {groups
        .filter((group) => group.length)
        .map((group) => (
          <article className="translation-segment" key={group[0].id}>
            <p className="source-meta">
              {stamp(group[0].start_seconds)}
              {group.at(-1)!.end_seconds !== null
                ? ` → ${stamp(group.at(-1)!.end_seconds)}`
                : ""}{" "}
              · {group[0].provenance} · Retrieved {date(group[0].retrieved_at)}
            </p>
            <div className="translation-pair">
              <div>
                <small>Original</small>
                {youtube ? (
                  group.map((s) => (
                    <div key={s.id}>
                      <small>
                        {stamp(s.start_seconds)} → {stamp(s.end_seconds)}
                      </small>
                      <p dir="auto">{s.text}</p>
                    </div>
                  ))
                ) : (
                  <p dir="auto">{group.map((s) => s.text).join(" ")}</p>
                )}
              </div>
              {target && (
                <div lang={target} dir={target === "ur" ? "rtl" : "ltr"}>
                  <small>{target === "ur" ? "Urdu" : "English"}</small>
                  {youtube ? (
                    <>
                      <p className="source-meta">
                        {data?.captionTrack
                          ? `Retrieved ${date(data.captionTrack.retrievedAt)} · YouTube cue timestamps`
                          : ""}
                      </p>
                      {visibleCues.map((cue) => (
                        <div key={cue.id}>
                          <small>
                            {stamp(cue.startSeconds)} → {stamp(cue.endSeconds)}
                          </small>
                          <p>{cue.text}</p>
                          <a
                            href={link(video.url, cue.startSeconds)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open caption timestamp ↗
                          </a>
                        </div>
                      ))}
                      {data?.captionTrack && !visibleCues.length && (
                        <p>No YouTube captions overlap this displayed range.</p>
                      )}
                      {!data?.captionTrack && (
                        <p>
                          {unavailable
                            ? "[YouTube captions unavailable]"
                            : "[YouTube captions pending…]"}
                        </p>
                      )}
                    </>
                  ) : (
                    <p>
                      {group
                        .map(
                          (s) =>
                            cached.get(s.id)?.text ||
                            (data?.job?.status === "failed" ||
                            (!data?.available && data)
                              ? "[Translation unavailable]"
                              : "[Translation pending…]"),
                        )
                        .join(" ")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <a
              href={link(video.url, group[0].start_seconds)}
              target="_blank"
              rel="noreferrer"
            >
              Open this timestamp ↗
            </a>
          </article>
        ))}
      {full && (
        <PageControls
          page={page}
          total={segments.length}
          onChange={setPage}
          label="transcript segments"
        />
      )}
    </section>
  );
}
