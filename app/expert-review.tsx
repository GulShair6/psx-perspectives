"use client";
import { useState, useEffect } from "react";
import { StockPicker } from "./research-ui";
import { api, date, stamp, link, type Statement, type Preview } from "./expert-shared";
import TranscriptTranslation from "./transcript-translation";
export function AliasEditor({
  stocks,
  save,
}: {
  stocks: { symbol: string; name: string; aliases: string }[];
  save: (s: string, a: string[]) => Promise<void>;
}) {
  const [symbol, setSymbol] = useState(""),
    [aliases, setAliases] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(
          symbol,
          aliases
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
        );
      }}
    >
      <StockPicker
        label="Catalog stock"
        stocks={stocks}
        value={symbol}
        empty="Choose stock"
        onChange={(v) => {
          setSymbol(v);
          setAliases(
            JSON.parse(
              stocks.find((s) => s.symbol === v)?.aliases || "[]",
            ).join("\n"),
          );
        }}
      />
      <label>
        Aliases, one per line
        <textarea
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          maxLength={3000}
        />
      </label>
      <button disabled={!symbol}>Save stock aliases</button>
    </form>
  );
}

export function StatementReview({
  statement: s,
  stocks,
  save,
}: {
  statement: Statement;
  stocks: { symbol: string; name?: string }[];
  save: (p: unknown, next: boolean) => Promise<void>;
}) {
  const [symbol, setSymbol] = useState(s.symbols?.split(",")[0] || ""),
    [stance, setStance] = useState(s.stance),
    [action, setAction] = useState(s.action || ""),
    [rationale, setRationale] = useState(s.rationale),
    [target, setTarget] = useState(s.target || ""),
    [horizon, setHorizon] = useState(s.horizon || ""),
    [speaker, setSpeaker] = useState(s.speaker || ""),
    [evaluate, setEvaluate] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [original, setOriginal] = useState(s.quote),
    [source, setSource] = useState<Preview | null>(null);
  useEffect(() => {
    setSymbol(s.symbols?.split(",")[0] || "");
    setStance(s.stance);
    setAction(s.action || "");
    setRationale(s.rationale);
    setTarget(s.target || "");
    setHorizon(s.horizon || "");
    setSpeaker(s.speaker || "");
    setEvaluate(false);
    setError("");
  }, [s]);
  useEffect(() => {
    let canceled = false;
    setSource(null);
    setOriginal("Loading saved passage…");
    api<Preview>("video?id=" + s.video_id)
      .then((d) => {
        if (!canceled) {
          setSource(d);
          setOriginal(
            d.chunks.find((c) => c.id === s.chunk_id)?.text ||
              "Original passage unavailable; inspect the video before approving.",
          );
        }
      })
      .catch(() => {
        if (!canceled)
          setOriginal(
            "Could not load original passage; close and reopen to retry.",
          );
      });
    return () => {
      canceled = true;
    };
  }, [s.video_id, s.chunk_id]);
  const segmentIds = new Set(source?.chunks.find(c => c.id === s.chunk_id)?.segmentIds || []);
  const segments = source?.video.id === s.video_id ? source.segments.filter(row => segmentIds.has(row.id)) : [];
  async function submit(status: string, next = false) {
    setSaving(true);
    setError("");
    try {
      await save(
        {
          id: s.id,
          symbol: symbol || null,
          stance,
          action: action || null,
          rationale,
          target: target || null,
          horizon: horizon || null,
          speaker: speaker || null,
          status,
          evaluate,
        },
        next,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="statement-review">
      <aside className="review-original">
        <p>
          {date(s.published_at)} · {stamp(s.start_seconds)} · {s.attribution}
        </p>
        <details open>
          <summary>Original saved passage</summary>
          {source && segments.length ? <TranscriptTranslation video={source.video} segments={segments} /> : <p dir="auto">{original}</p>}
        </details>
        <blockquote dir="auto">{s.quote}</blockquote>
        <a href={link(s.url, s.start_seconds)} target="_blank" rel="noreferrer">
          Original timestamp ↗
        </a>
      </aside>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit("reviewed");
        }}
      >
        <StockPicker
          stocks={stocks}
          value={symbol}
          empty="General topic"
          onChange={setSymbol}
        />
        <label>
          Stance
          <select value={stance} onChange={(e) => setStance(e.target.value)}>
            {["bullish", "bearish", "neutral"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Explicit action
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">No explicit action</option>
            {["buy", "sell", "hold", "watch", "avoid"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Rationale
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            maxLength={1200}
          />
        </label>
        <label>
          Explicit target (exact quote)
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            maxLength={150}
          />
        </label>
        <label>
          Explicit horizon (exact quote)
          <input
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            maxLength={150}
          />
        </label>
        <label>
          Speaker (only if named in the quote)
          <input
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={evaluate}
            onChange={(e) => setEvaluate(e.target.checked)}
          />{" "}
          Use corrected stock and stance as my independent accuracy reference
        </label>
        <p className="source-meta">AI translation is a reading aid. Confirm the original caption or audio before using it as an independent accuracy reference.</p>
        {error && <p role="alert">{error}</p>}
        <div className="expert-actions">
          <button disabled={saving}>Save review</button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit("reviewed", true)}
          >
            Save and next
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit("rejected")}
          >
            Reject statement
          </button>
        </div>
      </form>
    </div>
  );
}
