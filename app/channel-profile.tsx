"use client";
import { useEffect, useState } from "react";
import { PageControls, ReadableError } from "./research-ui";
import {
  date,
  stamp,
  link,
  type Channel,
  type Statement,
  type Video,
} from "./expert-shared";
export default function ChannelProfile({
  channel,
  timeline,
  topic,
  setTopic,
  close,
  setReview,
  openVideo,
}: {
  channel?: Channel;
  timeline: {
    statements: Statement[];
    videos: Video[];
    reviews: {
      id: number;
      symbol: string;
      speaker: string;
      stance: string;
      quote: string;
      published_at: string;
    }[];
  } | null;
  topic: string;
  setTopic: (t: string) => void;
  close: () => void;
  setReview: (s: Statement) => void;
  openVideo: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState("timeline"),
    [page, setPage] = useState(0);
  useEffect(() => setPage(0), [channel?.id, topic]);
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("profileTab");
    if (t === "videos") setTab("videos");
  }, []);
  const chooseTab = (t: string) => {
    setTab(t);
    setPage(0);
    const q = new URLSearchParams(location.search);
    q.set("profileTab", t);
    history.replaceState(null, "", `${location.pathname}?${q}`);
  };
  return (
    <section className="panel" aria-label="Channel insights">
      <div className="section-head">
        <h2>{channel?.name} — dated insights</h2>
        <button onClick={() => close()}>Close timeline</button>
      </div>
      <label>
        Topic filter
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={100}
          placeholder="cement, market, dividend…"
        />
      </label>
      <p>
        Uses the dates and stock filter above. AI-generated, not human-reviewed.
        Quarantined claims are excluded from answers.
      </p>
      <div className="view-tabs" role="group" aria-label="Channel profile view">
        <button
          aria-pressed={tab === "timeline"}
          onClick={() => {
            chooseTab("timeline");
          }}
        >
          Timeline
        </button>
        <button
          aria-pressed={tab === "videos"}
          onClick={() => {
            chooseTab("videos");
          }}
        >
          Videos
        </button>
      </div>
      {tab === "timeline" && timeline?.reviews.length ? (
        <div className="alert">
          <h3>Human-approved commentary</h3>
          {timeline.reviews.map((r) => (
            <p key={r.id}>
              {r.symbol} · {r.speaker} · {r.stance} · {date(r.published_at)} —{" "}
              {r.quote}
            </p>
          ))}
        </div>
      ) : null}
      {tab === "timeline" &&
        timeline?.statements.slice(page * 25, (page + 1) * 25).map((s) => (
          <article className="statement" key={s.id}>
            <p>
              <strong>
                {s.symbols || s.topics} · {s.stance}
              </strong>{" "}
              {s.action
                ? `· Explicit action: ${s.action}`
                : "· No explicit action"}{" "}
              ·{" "}
              {s.status === "quarantined"
                ? "Quarantined"
                : s.status === "reviewed"
                  ? "Human-reviewed"
                  : s.status === "rejected"
                    ? "Rejected"
                    : "AI-generated, not human-reviewed"}
            </p>
            <p>
              {date(s.published_at)} · Attributed to{" "}
              {s.channel || channel?.name}
              {s.speaker ? ` / ${s.speaker}` : " (speaker not established)"}
            </p>
            <details>
              <summary>Supporting passage</summary>
              <blockquote dir="auto">{s.quote}</blockquote>
            </details>
            <p>{s.rationale}</p>
            {s.target && <p>Historical stated target: {s.target}</p>}
            {s.horizon && <p>Explicit horizon: {s.horizon}</p>}
            {s.validation_error && (
              <p className="danger-text">{s.validation_error}</p>
            )}
            <button onClick={() => setReview(s)}>
              Review / correct statement
            </button>
            <button onClick={() => void openVideo(s.video_id)}>
              Inspect original transcript
            </button>
            <a
              href={link(s.url, s.start_seconds)}
              target="_blank"
              rel="noreferrer"
            >
              {" "}
              {stamp(s.start_seconds)} on YouTube ↗
            </a>
          </article>
        ))}
      {tab === "timeline" && timeline && !timeline.statements.length && (
        <p>
          No supported statements yet. Indexed transcripts are searchable
          immediately.
        </p>
      )}
      {tab === "videos" && <h3>Transcript library & summaries</h3>}
      {tab === "videos" &&
        timeline?.videos.slice(page * 25, (page + 1) * 25).map((v) => (
          <article className="statement" key={v.id}>
            <h3>{v.title}</h3>
            <p>
              {date(v.published_at)} · {v.language} ·{" "}
              {!v.content_hash
                ? "Captions missing"
                : !v.chunk_count
                  ? "Indexing"
                  : v.analysis_status === "done"
                    ? "Insights ready"
                    : v.analysis_status || "Indexed; awaiting analysis"}
            </p>
            {v.summary && (
              <details>
                <summary>Read cited summary</summary>
                <p>AI-generated, not human-reviewed</p>
                <p>{v.summary}</p>
                {(
                  JSON.parse(v.summary_evidence || "[]") as {
                    chunk_id: number;
                    quote: string;
                    text: string;
                  }[]
                ).map((s, i) => (
                  <details key={i}>
                    <summary>Summary evidence {i + 1}</summary>
                    <details>
                      <summary>Supporting passage</summary>
                      <blockquote dir="auto">{s.quote}</blockquote>
                    </details>
                    <button onClick={() => void openVideo(v.id)}>
                      Open original transcript
                    </button>
                  </details>
                ))}
              </details>
            )}
            {v.analysis_status === "done" && !v.summary && (
              <p>No supported opinions found.</p>
            )}
            {(v.error || v.analysis_error) && (
              <ReadableError message={v.error || v.analysis_error || ""} />
            )}
            <button
              disabled={!v.content_hash}
              onClick={() => void openVideo(v.id)}
            >
              Preview transcript
            </button>
            <a href={v.url} target="_blank" rel="noreferrer">
              {" "}
              Original video ↗
            </a>
          </article>
        ))}
      <PageControls
        page={page}
        total={
          tab === "videos"
            ? timeline?.videos.length || 0
            : timeline?.statements.length || 0
        }
        onChange={setPage}
        label={tab}
      />
    </section>
  );
}
