"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ExpertEvidence } from "@/lib/expert";
import {
  api,
  date,
  stamp,
  link,
  evidenceText,
  type Preview,
} from "./expert-shared";
import { Modal } from "./research-ui";
import TranscriptTranslation from "./transcript-translation";
export default function EvidenceReader({
  evidence,
  close,
}: {
  evidence: ExpertEvidence;
  close: () => void;
}) {
  const [wide, setWide] = useState(false),
    [context, setContext] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia("(min-width: 1440px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let canceled = false;
    setContext(null);
    setError("");
    if (evidence.video_id)
      api<Preview>("video?id=" + encodeURIComponent(evidence.video_id))
        .then((d) => {
          if (!canceled) setContext(d);
        })
        .catch(() => {
          if (!canceled)
            setError(
              "Could not load neighboring context. Reopen this citation to retry.",
            );
        });
    return () => {
      canceled = true;
    };
  }, [evidence]);
  useEffect(() => {
    if (!wide) return;
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => {
      previous?.isConnected && previous.focus();
    };
  }, [wide, evidence]);
  const quote = evidenceText(evidence);
  const mappedIds = new Set(
    context?.chunks.find((c) => evidence.id === `chunk:${c.id}`)?.segmentIds ||
      [],
  );
  if (!mappedIds.size && context && evidence.kind === "transcript") {
    const chunk = context.chunks.find((c) => c.text.includes(quote));
    for (const id of chunk?.segmentIds || []) mappedIds.add(id);
  }
  const index =
    context?.segments.findIndex((s) =>
      mappedIds.size
        ? mappedIds.has(s.id)
        : evidence.start_seconds !== null
          ? s.start_seconds !== null &&
            s.start_seconds <= evidence.start_seconds! &&
            (s.end_seconds === null || s.end_seconds >= evidence.start_seconds!)
          : s.text.includes(quote),
    ) ?? -1;
  const segments =
    context && index >= 0
      ? context.segments.filter(
          (s, i) =>
            mappedIds.has(s.id) ||
            (i >= Math.max(0, index - 1) && i < index + 3),
        )
      : [];
  const content = (
    <>
      <p className="eyebrow">SAVED SOURCE · {evidence.kind}</p>
      <h3>{evidence.title}</h3>
      <p className="source-meta">
        {evidence.channel}
        <br />
        {date(evidence.date)} · {stamp(evidence.start_seconds)}
      </p>
      <span className="badge">{evidence.review}</span>
      <blockquote dir="auto">
        <mark>{quote}</mark>
      </blockquote>
      <a
        className="source-link"
        href={link(evidence.url, evidence.start_seconds)}
        target="_blank"
        rel="noreferrer"
      >
        Open original source ↗
      </a>
      {!!evidence.statements?.length && (
        <section className="neighbor-context">
          <h3>Saved perspectives</h3>
          {evidence.statements.map((s, i) => (
            <div key={i}>
              <small>
                {s.review === "reviewed"
                  ? "Human-reviewed"
                  : "AI-generated, not human-reviewed"}
                {s.symbols.length ? ` · ${s.symbols.join(", ")}` : ""} ·{" "}
                {s.stance}
                {s.explicitAction
                  ? ` · Explicit action: ${s.explicitAction}`
                  : ""}
              </small>
              <p dir="auto">{s.rationale}</p>
              {s.hypothetical && <p>Hypothetical or educational example.</p>}
              {s.historicalTarget && (
                <p>Historical stated target: {s.historicalTarget}</p>
              )}
              {s.explicitHorizon && (
                <p>Explicit horizon: {s.explicitHorizon}</p>
              )}
            </div>
          ))}
        </section>
      )}
      {evidence.video_id && (
        <section className="neighbor-context">
          <h3>Original transcript context</h3>
          {error && <p role="status">{error}</p>}
          {!context && !error && <p role="status">Loading saved context…</p>}
          {context && !segments.length && (
            <p>
              Exact segment mapping is unavailable. The saved cited passage is
              shown above.
            </p>
          )}
          {context?.video.id === evidence.video_id && !!segments.length && (
            <TranscriptTranslation video={context.video} segments={segments} />
          )}
        </section>
      )}
    </>
  );
  return wide ? (
    <aside
      ref={ref}
      tabIndex={-1}
      className="evidence-reader"
      aria-label="Saved evidence"
    >
      <div className="section-head">
        <h2>Saved evidence</h2>
        <button
          className="icon-button"
          aria-label="Close preview"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      {content}
    </aside>
  ) : (
    <Modal title="Saved evidence" close={close} className="evidence-sheet">
      {content}
    </Modal>
  );
}
