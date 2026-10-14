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
  const index =
    context?.segments.findIndex((s) =>
      evidence.start_seconds !== null
        ? s.start_seconds !== null &&
          s.start_seconds <= evidence.start_seconds! &&
          (s.end_seconds === null || s.end_seconds >= evidence.start_seconds!)
        : s.text.includes(quote),
    ) ?? -1;
  const segments =
    context && index >= 0
      ? context.segments.slice(Math.max(0, index - 1), index + 3)
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
          {segments.map((s) => (
            <div key={s.id}>
              <small>{stamp(s.start_seconds)}</small>
              <p dir="auto">{s.text}</p>
            </div>
          ))}
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
