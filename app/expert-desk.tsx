"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, BookOpen } from "lucide-react";
import { today } from "@/lib/time";
import type { ExpertEvidence } from "@/lib/expert";
import {
  api,
  date,
  stamp,
  link,
  type Data,
  type Match,
  type Statement,
  type Video,
  type Answer,
  type Preview,
} from "./expert-shared";
import { Modal, StockPicker, PageControls, ReadableError } from "./research-ui";
import ChannelRail from "./channel-rail";
import ChannelProfile from "./channel-profile";
import ResearchAnswer from "./research-answer";
import EvidenceReader from "./evidence-reader";
import { StatementReview } from "./expert-review";
export default function ExpertDesk({
  workerOnline,
  jobs,
  initialChannel,
}: {
  initialChannel?: number | null;
  workerOnline: boolean;
  jobs: {
    id: number;
    type: string;
    status: string;
    progress: string;
    error: string | null;
  }[];
}) {
  const [data, setData] = useState<Data | null>(null),
    [connection, setConnection] = useState(""),
    [profileError, setProfileError] = useState(""),
    [error, setError] = useState(""),
    [chatError, setChatError] = useState(""),
    [busy, setBusy] = useState(false),
    [asking, setAsking] = useState(false),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [matches, setMatches] = useState<Match[]>([]),
    [selected, setSelected] = useState<number[]>([]),
    [profile, setProfile] = useState<number | null>(initialChannel || null);
  const [since, setSince] = useState(
      today(new Date(Date.now() - 90 * 86400000)),
    ),
    [until, setUntil] = useState(today()),
    [symbol, setSymbol] = useState(""),
    [topic, setTopic] = useState(""),
    [mode, setMode] = useState<"transcript" | "combined">("transcript"),
    [question, setQuestion] = useState("");
  const [timeline, setTimeline] = useState<{
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
    } | null>(null),
    [answer, setAnswer] = useState<Answer | null>(null),
    [evidence, setEvidence] = useState<ExpertEvidence | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [review, setReview] = useState<Statement | null>(null),
    [scope, setScope] = useState<{
      indexed: number;
      reviewed: number;
      missing: number;
      complete: boolean;
      cutoff: string | null;
    } | null>(null);
  const [discover, setDiscover] = useState(false),
    [view, setView] = useState(initialChannel ? "channel" : "question"),
    [previewPage, setPreviewPage] = useState(0),
    [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("view") === "channel") setView("channel");
    const id = Number(p.get("channel"));
    if (Number.isInteger(id) && id > 0) setProfile(id);
    for (const [key, set] of [
      ["from", setSince],
      ["through", setUntil],
    ] as const) {
      const value = p.get(key);
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) set(value);
    }
    if (p.has("stock")) setSymbol(p.get("stock") || "");
    if (p.has("topic")) setTopic((p.get("topic") || "").slice(0, 100));
    if (p.get("evidence") === "combined") setMode("combined");
    if (p.has("channels"))
      setSelected(
        (p.get("channels") || "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
          .slice(0, 20),
      );
    setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams(location.search);
    p.set("view", view);
    if (profile) p.set("channel", String(profile));
    else p.delete("channel");
    p.set("channels", selected.join(","));
    p.set("from", since);
    p.set("through", until);
    symbol ? p.set("stock", symbol) : p.delete("stock");
    topic ? p.set("topic", topic) : p.delete("topic");
    p.set("evidence", mode);
    history.replaceState(null, "", `${location.pathname}?${p}`);
  }, [urlReady, view, profile, selected, since, until, symbol, topic, mode]);
  const reload = useCallback(async () => {
    try {
      const d = await api<Data>("channels");
      setData(d);
      setConnection("");
    } catch (e) {
      setConnection(
        e instanceof Error ? e.message : "Channel status unavailable",
      );
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    try {
      const ids = JSON.parse(
        localStorage.getItem("psx-expert-channels") || "[]",
      );
      if (
        Array.isArray(ids) &&
        !new URLSearchParams(location.search).has("channels")
      )
        setSelected(ids.filter((x) => Number.isInteger(x) && x > 0));
    } catch {}
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    localStorage.setItem("psx-expert-channels", JSON.stringify(selected));
  }, [selected]);
  useEffect(() => {
    if (!profile) return;
    let canceled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          id: String(profile),
          since,
          until,
        });
        if (symbol) params.set("symbol", symbol);
        if (topic) params.set("topic", topic);
        const d = await api<typeof timeline>("channels/insights?" + params);
        if (!canceled) {
          setTimeline(d);
          setProfileError("");
        }
      } catch (e) {
        if (!canceled)
          setProfileError(
            e instanceof Error ? e.message : "Insights unavailable",
          );
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [profile, since, until, symbol, topic]);
  useEffect(() => {
    if (!selected.length) {
      setScope(null);
      return;
    }
    let canceled = false;
    const load = async () => {
      try {
        const d = await api<typeof scope>(
          "channels/evidence?" +
            new URLSearchParams({ ids: selected.join(","), since, until }),
        );
        if (!canceled) setScope(d);
      } catch {
        if (!canceled) setScope(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [selected, since, until]);
  async function act(path: string, payload: unknown) {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ job?: number; source_id?: number }>(
        path,
        payload,
      );
      if (result.source_id) {
        setSelected((ids) => [...new Set([...ids, result.source_id!])]);
        setProfile(result.source_id);
        setView("channel");
        setDiscover(false);
        setMatches([]);
      }
      setNotice(
        result.job
          ? `Job ${result.job} queued. Progress appears below.`
          : "Saved",
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    setError("");
    try {
      setMatches(
        (
          await api<{ channels: Match[] }>(
            "channels/search?q=" + encodeURIComponent(query),
          )
        ).channels,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }
  async function openVideo(id: string) {
    setError("");
    try {
      setPreviewPage(0);
      setPreview(await api<Preview>("video?id=" + encodeURIComponent(id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }
  async function ask() {
    setChatError("");
    setAsking(true);

    try {
      setAnswer(
        await api<Answer>("chat", {
          question,
          channelIds: selected,
          symbols: symbol ? [symbol] : [],
          topics: topic.trim() ? [topic.trim()] : [],
          since,
          until,
          mode,
        }),
      );
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setAsking(false);
    }
  }
  const active = jobs
    .filter(
      (j) =>
        ["channel_sync", "insights", "catalog"].includes(j.type) &&
        ["queued", "running", "failed"].includes(j.status),
    )
    .slice(0, 8);
  return (
    <div className={`expert-workspace ${evidence ? "has-evidence" : ""}`}>
      <div className="expert-notices">
        {(connection || profileError) && (
          <div className="alert danger" role="status">
            Connection warning: {connection || profileError}. Saved content is
            retained.{" "}
            <button onClick={() => void reload()}>Retry status</button>
          </div>
        )}
        {error && (
          <div className="alert danger" role="alert">
            <ReadableError message={error} />
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      <ChannelRail
        channels={data?.channels || []}
        selected={selected}
        toggle={(id) =>
          setSelected((ids) =>
            ids.includes(id)
              ? ids.filter((x) => x !== id)
              : [...ids, id].slice(0, 20),
          )
        }
        open={(id) => {
          setProfile(id);
          setView("channel");
        }}
        add={() => setDiscover(true)}
        act={act}
        busy={busy}
      />
      <div className="research-column">
        <div className="workspace-toolbar">
          <div
            className="view-tabs"
            role="group"
            aria-label="Expert research view"
          >
            <button
              aria-pressed={view === "question"}
              onClick={() => setView("question")}
            >
              Research questions
            </button>
            {profile && (
              <button
                aria-pressed={view === "channel"}
                onClick={() => setView("channel")}
              >
                Channel profile
              </button>
            )}
          </div>
          <button onClick={() => setDiscover(true)}>
            <Plus size={14} /> Add Channel
          </button>
        </div>
        <div className="research-health">
          <span>
            <BookOpen size={14} />
            {data?.channels.reduce((n, c) => n + c.indexed, 0) || 0} indexed
            transcripts
          </span>
          <span>{workerOnline ? "Worker online" : "Worker offline"}</span>
          <span>AI insights · Review required</span>
        </div>
        {view === "question" ? (
          <section className="research-document">
            <span className="eyebrow">EXPERT RESEARCH</span>
            <h2>Ask these channels</h2>
            <p>
              {selected
                .map((id) => data?.channels.find((c) => c.id === id)?.name)
                .filter(Boolean)
                .join(", ") || "Select at least one followed channel."}
            </p>
            <div className="expert-filters">
              <label htmlFor="expert-topic">
                Topic keyword
                <input
                  id="expert-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  maxLength={100}
                  placeholder="Optional: dividend, cement…"
                />
              </label>
              <label>
                From (Pakistan time)
                <input
                  type="date"
                  value={since}
                  max={until}
                  onChange={(e) => setSince(e.target.value)}
                />
              </label>
              <label>
                Through (Pakistan time)
                <input
                  type="date"
                  value={until}
                  min={since}
                  max={today()}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <StockPicker
                stocks={data?.catalog || []}
                value={symbol}
                onChange={setSymbol}
              />
              <label>
                Evidence
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="transcript">Expert transcripts only</option>
                  <option value="combined">
                    Also include official company data
                  </option>
                </select>
              </label>
            </div>
            {scope && (
              <p
                className="scope-summary"
                aria-label="Available channel evidence"
              >
                {scope.indexed} indexed transcripts · {scope.reviewed}{" "}
                human-reviewed statements · {scope.missing} missing transcripts
                ·{" "}
                {scope.complete ? "Discovery complete" : "Discovery incomplete"}{" "}
                · Evidence cutoff {date(scope.cutoff)}
              </p>
            )}
            <form
              className="question-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <label htmlFor="expert-question">
                Research question
                <textarea
                  id="expert-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={1500}
                  required
                  minLength={3}
                  placeholder="What have these channels said about FFC recently? Did their views change?"
                />
              </label>
              <p className="composer-note">
                Latest indexed commentary in this period is the evidence cutoff.
                Missing captions and incomplete collection remain gaps.
              </p>
              <button
                className="primary"
                disabled={
                  asking || !selected.length || question.trim().length < 3
                }
              >
                {asking ? "Searching dated evidence…" : "Ask selected channels"}
              </button>
            </form>
            {chatError && (
              <div className="alert danger" role="alert">
                {chatError}{" "}
                <button onClick={() => void ask()} disabled={asking}>
                  Retry question
                </button>
              </div>
            )}
            {answer && (
              <ResearchAnswer answer={answer} setEvidence={setEvidence} />
            )}
          </section>
        ) : (
          <>
            <div className="profile-window">
              <label>
                From (Pakistan time)
                <input
                  type="date"
                  value={since}
                  max={until}
                  onChange={(e) => setSince(e.target.value)}
                />
              </label>
              <label>
                Through (Pakistan time)
                <input
                  type="date"
                  value={until}
                  min={since}
                  max={today()}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <StockPicker
                stocks={data?.catalog || []}
                value={symbol}
                onChange={setSymbol}
              />
            </div>
            <ChannelProfile
              channel={data?.channels.find((c) => c.id === profile)}
              timeline={timeline}
              topic={topic}
              setTopic={setTopic}
              close={() => setView("question")}
              setReview={setReview}
              openVideo={openVideo}
            />
          </>
        )}
        {data?.pipeline.analysis_paused && (
          <div className="alert danger" role="status">
            <ReadableError message={data.pipeline.analysis_paused} />
            <p>Transcripts remain searchable.</p>
            <button
              disabled={busy}
              onClick={() => void act("insights/resume", {})}
            >
              Resume cloud analysis
            </button>
          </div>
        )}
        {!!active.length && (
          <details className="processing-panel">
            <summary>
              Collection & analysis progress{" "}
              <span className="badge">{active.length} jobs need attention</span>
            </summary>
            <button
              disabled={busy}
              onClick={() => void act("insights/resume", {})}
            >
              Retry failed analyses
            </button>
            {active.map((j) => (
              <article className="job" key={j.id}>
                <div>
                  <span className="badge">{j.status}</span>
                  <strong>{j.type.replaceAll("_", " ")}</strong>
                  {j.error ? (
                    <ReadableError message={j.error} />
                  ) : (
                    <p>{j.progress}</p>
                  )}
                </div>
              </article>
            ))}
          </details>
        )}
      </div>
      {evidence && (
        <EvidenceReader evidence={evidence} close={() => setEvidence(null)} />
      )}
      {discover && (
        <Modal title="Find an expert channel" close={() => setDiscover(false)}>
          <div className="section-head">
            <div>
              <h3>Confirm the voice you want to follow</h3>
              <p>
                Search by name, paste a YouTube channel URL, or enter @handle.
                Confirm the identity before collecting.
              </p>
            </div>
          </div>
          {!data?.youtubeConfigured && (
            <div className="alert">
              Full history collection needs YOUTUBE_DATA_API_KEY in the server’s
              .env. Existing transcripts remain searchable.
            </div>
          )}
          {error && (
            <div className="alert danger" role="alert">
              <ReadableError message={error} />
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="expert-search"
          >
            <label htmlFor="channel-search">
              Channel name or URL
              <input
                id="channel-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={200}
                placeholder="InvestKaar, @handle, or channel URL"
                required
              />
            </label>
            <button className="primary" disabled={busy || !query.trim()}>
              Search channels
            </button>
          </form>
          <div className="channel-grid">
            {matches.map((c) => (
              <article key={c.id} className="channel-card">
                {c.thumbnail && (
                  <img
                    src={c.thumbnail}
                    alt=""
                    width={48}
                    height={48}
                    referrerPolicy="no-referrer"
                  />
                )}
                <h3>{c.name}</h3>
                <p>{c.handle || "Handle unavailable"}</p>
                <a href={c.url} target="_blank" rel="noreferrer">
                  Check channel on YouTube ↗
                </a>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act("channels/follow", { id: c.id, confirmed: true })
                  }
                >
                  Confirm and follow {c.name}
                </button>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          key={review.id}
          title="Review automatic statement"
          close={() => setReview(null)}
        >
          <StatementReview
            statement={review}
            stocks={data?.catalog || []}
            save={async (payload, next) => {
              setError("");
              try {
                await api("statements/review", payload);
                setTimeline((t) =>
                  t
                    ? {
                        ...t,
                        statements: t.statements.map((s) =>
                          s.id === review.id ? { ...s, status: "reviewed" } : s,
                        ),
                      }
                    : t,
                );
                setReview(
                  next
                    ? timeline?.statements.find(
                        (s) => s.id !== review.id && s.status === "unreviewed",
                      ) || null
                    : null,
                );
                setNotice("Review saved; original extraction preserved.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Review failed");
                throw e;
              }
            }}
          />
        </Modal>
      )}
      {preview && (
        <Modal title={preview.video.title} close={() => setPreview(null)}>
          <p>{preview.video.language} · Original saved segments</p>
          {preview.segments
            .slice(previewPage * 25, (previewPage + 1) * 25)
            .map((s) => (
              <article className="statement" key={s.id}>
                <p>
                  {stamp(s.start_seconds)}
                  {s.end_seconds !== null
                    ? ` → ${stamp(s.end_seconds)}`
                    : ""} · {s.provenance} · Retrieved {date(s.retrieved_at)}
                </p>
                <p dir="auto">{s.text}</p>
                <a
                  href={link(preview.video.url, s.start_seconds)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open this timestamp ↗
                </a>
              </article>
            ))}
          <PageControls
            page={previewPage}
            total={preview.segments.length}
            onChange={setPreviewPage}
            label="transcript segments"
          />
        </Modal>
      )}
    </div>
  );
}
