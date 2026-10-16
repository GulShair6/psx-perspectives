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
  const [page, setPage] = useState(0);
  const [prepareAll, setPrepareAll] = useState(false);
  const requested =
    full && !prepareAll ? segments.slice(page * 25, (page + 1) * 25) : segments;
  const ids = requested.map((s) => s.id).join(",");
  const scope = `${video.id}:${video.content_hash}:${full ? "all" : ids}`;
  const [target, setTarget] = useState<"ur" | "en" | null>(null);
  const [method, setMethod] = useState<"local" | "youtube" | "ollama">("local");
  const [result, setResult] = useState<{
    scope: string;
    value: TranslationState;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  const query = `translations?videoId=${encodeURIComponent(video.id)}&target=${target || "ur"}&method=${method}${full && (method !== "local" || prepareAll) ? "" : `&segmentIds=${encodeURIComponent(ids)}`}`;
  useEffect(() => {
    serial.current++;
    setTarget(null);
    setMethod("local");
    setResult(null);
    setError("");
    setBusy(false);
    setPage(0);
    setPrepareAll(false);
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
    source: "local" | "youtube" | "ollama" = "local",
    all = false,
  ) {
    const request = ++serial.current;
    const current = () => serial.current === request;
    setPrepareAll(all);
    setTarget(language);
    setMethod(source);
    setBusy(true);
    setError("");
    const selected =
      full && !all && source === "local"
        ? segments.slice(page * 25, (page + 1) * 25)
        : segments;
    const path = `translations?videoId=${encodeURIComponent(video.id)}&target=${language}&method=${source}${full && (source !== "local" || all) ? "" : `&segmentIds=${encodeURIComponent(selected.map((s) => s.id).join(","))}`}`;
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
          ...(full && (source !== "local" || all)
            ? {}
            : { segmentIds: selected.map((s) => s.id) }),
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

  useEffect(() => {
    if (target && method === "local") void translate(target, "local");
  }, [page]);
  useEffect(() => {
    const request = serial.current;
    void api<TranslationState>(
      `translations?videoId=${encodeURIComponent(video.id)}&target=ur&method=local&segmentIds=${encodeURIComponent(
        segments
          .slice(0, full ? 25 : segments.length)
          .map((s) => s.id)
          .join(","),
      )}`,
    )
      .then((state) => {
        if (serial.current === request && state.quality?.validated)
          void translate("ur", "local");
      })
      .catch(() => {});
  }, [scope]);
  const cached = new Map(
    data?.translations.map((row) => [row.segmentId, row]) || [],
  );
  const visible = full ? segments.slice(page * 25, (page + 1) * 25) : segments;
  const youtube = !!target && method === "youtube";
  const local = !!target && method === "local";
  const groups =
    full && !youtube && !local ? visible.map((s) => [s]) : [visible];
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
  const localBlocks =
    data?.blocks.filter((b) =>
      b.segmentIds.some((id) => visible.some((s) => s.id === id)),
    ) || [];
  const count = local
    ? data?.blocks.length || 0
    : data?.translations.length || 0;
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
            {method === "local"
              ? "Local AI translation"
              : method === "ollama"
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
                  ? `Translation completed · ${count}/${data.total} ${local ? "blocks" : "segments"}`
                  : `${count ? `Partially translated · ${count}/${data?.total} segments. ` : ""}${data?.job?.status === "running" ? "Translating…" : data?.job?.status === "queued" ? "Queued for translation." : data?.job?.status === "failed" ? "Translation failed." : "Translation incomplete."}`}
          </p>
          {local && !data?.quality?.validated && (
            <p className="source-meta">
              Provisional translation: language quality has not passed the audio
              review trial.
            </p>
          )}
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
          {unavailable && method !== "ollama" && (
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
      {target && method === "local" && (
        <div className="expert-actions">
          {full && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void translate(target, "local", true)}
            >
              Prepare full transcript
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void translate(target, "youtube")}
          >
            Try YouTube captions
          </button>
        </div>
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
                  {local ? (
                    <>
                      <p className="source-meta">
                        Translation blocks include their surrounding source
                        context.
                      </p>
                      {localBlocks.map((block) => (
                        <div key={block.chunkId}>
                          <small>
                            {stamp(block.startSeconds)} →{" "}
                            {stamp(block.endSeconds)} ·{" "}
                            {block.provider === "ollama-cache"
                              ? "Saved Ollama AI translation reused"
                              : "Local AI translation"}
                          </small>
                          <p>{block.text}</p>
                          <a
                            href={link(video.url, block.startSeconds)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open block timestamp ↗
                          </a>
                        </div>
                      ))}
                      {!localBlocks.length && (
                        <p>
                          {unavailable
                            ? "[Translation unavailable]"
                            : "[Translation pending…]"}
                        </p>
                      )}
                    </>
                  ) : youtube ? (
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
