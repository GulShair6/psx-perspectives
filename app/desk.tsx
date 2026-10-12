"use client";
import { useCallback, useEffect, useState } from "react";
import { today } from "@/lib/time";
import type { Company, Opinion, Table, Citation } from "@/lib/types";
type Source = {
  id: number;
  name: string;
  url: string;
  channel_id: string | null;
  enabled: number;
  kind: string;
  verified_at: string | null;
  last_checked_at?: string | null;
  next_check_at?: string | null;
  last_error?: string | null;
};
type Video = {
  id: string;
  title: string;
  speaker: string;
  published_at: string;
  url: string;
  status: string;
  error: string | null;
};
type Job = {
  id: number;
  type: string;
  status: string;
  progress: string;
  error: string | null;
  updated_at: string;
};
type Row = Company & {
  classification: { status: string; as_of: string; source_url: string } | null;
  consensus: {
    bullish: number;
    bearish: number;
    neutral: number;
    sample: number;
  } | null;
};
type State = {
  companies: Row[];
  opinions: Opinion[];
  sources: Source[];
  videos: Video[];
  jobs: Job[];
  budget: { used: number; remaining: number; limit: number };
  gate: { enabled: boolean; reviewed: number; accuracy: number };
  aiConfigured: boolean;
  workerOnline: boolean;
};
type Answer = {
  facts: { text: string; evidenceIds: string[] }[];
  expertViews: { text: string; evidenceIds: string[] }[];
  interpretation: string;
  gaps: string[];
  citations: Citation[];
};
const tabs = [
  "Research",
  "Video library",
  "Opinion review",
  "Activity",
  "Settings",
];
const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: d });
const date = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString("en-GB", {
        timeZone: "Asia/Karachi",
        dateStyle: "medium",
        ...(s.length > 10 ? { timeStyle: "short" as const } : {}),
      })
    : "Not refreshed";
const metric = (c: Row, key: string) =>
  key === "price"
    ? c.snapshot?.price
    : key === "pe"
      ? c.snapshot?.pe
      : key === "return"
        ? c.snapshot?.priceReturn
        : key === "eps"
          ? c.snapshot?.annual.rows.find((r) => r.label === "EPS")?.values[0]
          : c.snapshot?.ratios.rows.find(
              (r) => r.label === "Net Profit Margin (%)",
            )?.values[0];
function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M8 23V16M16 23V9M24 23V13"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function FinancialTable({ title, t }: { title: string; t: Table }) {
  return (
    <div className="financial">
      <h3>{title}</h3>
      <p className="muted">{t.unit}</p>
      {t.periods.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                {t.periods.map((p) => (
                  <th key={p}>{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  {r.values.map((v, i) => (
                    <td key={i}>{fmt(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No financial summary available.</p>
      )}
      <small>{t.basis}</small>
    </div>
  );
}
export default function Desk() {
  const [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState("Research"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [asking, setAsking] = useState(false);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("symbol"),
    [descending, setDescending] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null),
    [since, setSince] = useState(() =>
      today(new Date(Date.now() - 90 * 86400000)),
    );
  const [review, setReview] = useState<Opinion | null>(null),
    [source, setSource] = useState<Source | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/state?since=${since}`);
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      setState(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load research");
    }
  }, [since]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (!review && !source) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".modal");
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) || [],
      ).filter((e) => !e.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function keys(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setReview(null);
        setSource(null);
      }
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [review, source]);
  async function action(path: string, input: unknown) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setNotice(
        data.job
          ? `Job #${data.job} queued. Follow progress in Activity.`
          : "Saved.",
      );
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function chat(e: React.FormEvent) {
    e.preventDefault();
    setAsking(true);
    setError("");
    setAnswer(null);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, symbols: selected, since }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setAnswer(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setAsking(false);
    }
  }
  const rows = (state?.companies || [])
    .filter(
      (c) =>
        `${c.symbol} ${c.name} ${c.sector}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter !== "watchlist" || c.watched) &&
        (filter !== "shariah" || c.classification?.status === "compliant"),
    )
    .sort((a, b) => {
      const av = metric(a, sort),
        bv = metric(b, sort);
      if (sort === "symbol")
        return a.symbol.localeCompare(b.symbol) * (descending ? -1 : 1);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return (av - bv) * (descending ? -1 : 1);
    });
  const company = state?.companies.find((c) => c.symbol === detail);
  const chosen =
    state?.companies.filter((c) => selected.includes(c.symbol)) || [];
  function toggle(symbol: string) {
    if (selected.includes(symbol))
      setSelected(selected.filter((s) => s !== symbol));
    else if (selected.length < 4) setSelected([...selected, symbol]);
    else setError("Compare up to four companies at a time.");
  }
  function sortBy(key: string) {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(key !== "symbol");
    }
  }
  const pendingReviews =
    state?.opinions.filter((o) => o.status === "pending").length || 0;
  return (
    <div className="desk">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PSX Research Desk home">
          <Mark />
          <span>
            PSX<span>Research Desk</span>
          </span>
        </a>
        <div className="workspace">
          <span className="dot" /> Personal workspace
          <span className="local">Local</span>
        </div>
        <nav aria-label="Main navigation">
          {tabs.map((t, i) => (
            <button
              key={t}
              className={tab === t ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(t);
                setDetail(null);
                setNotice("");
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {["▦", "▤", "✓", "◷", "⚙"][i]}
              </span>
              {t}
              {t === "Opinion review" && pendingReviews > 0 && (
                <span className="count">{pendingReviews}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <h3>Evidence before conviction.</h3>
          <p>Company facts and expert views, with the sources kept in sight.</p>
        </div>
        <div className="budget">
          <div>
            <span>Monthly AI budget</span>
            <strong>${fmt(state?.budget.remaining ?? 10)} left</strong>
          </div>
          <progress
            value={state?.budget.used || 0}
            max="10"
            aria-label="Monthly AI spend"
          />
          <small>${fmt(state?.budget.used || 0)} of $10 used</small>
        </div>
        <div className="worker">
          <span className={`dot ${state?.workerOnline ? "" : "offline"}`} />
          {state?.workerOnline ? "Ingestion worker online" : "Worker offline"}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Pakistan Stock Exchange{" "}
            <span className="subtle">/ Personal research</span>
          </span>
          <div>
            <span className="local">1–3 year horizon</span>
            <a className="export" href="/api/export?format=csv">
              Export CSV
            </a>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="alert danger" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert" role="status">
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>
                {company
                  ? company.symbol
                  : tab === "Research"
                    ? "A clearer view of your next investment."
                    : tab}
              </h1>
              <p>
                {company
                  ? company.name
                  : tab === "Research"
                    ? "Compare the companies. Understand the opinions. Follow the evidence."
                    : tab === "Video library"
                      ? "Build a dated library of the voices you follow."
                      : tab === "Opinion review"
                        ? "Check the original passage before accepting an expert’s view."
                        : tab === "Activity"
                          ? "Refreshes, imports and extraction jobs, with failures kept visible."
                          : "Manage research sources and verified classifications."}
              </p>
            </div>
            {tab === "Research" && !detail && (
              <button
                className="primary"
                disabled={pending || !state}
                onClick={() =>
                  action("refresh", {
                    symbols: state!.companies.map((c) => c.symbol),
                  })
                }
              >
                ↻ Refresh PSX data
              </button>
            )}
            {detail && (
              <button className="secondary" onClick={() => setDetail(null)}>
                Back to scorecard
              </button>
            )}
          </div>
          {!state ? (
            <div className="empty">Loading your research workspace…</div>
          ) : (
            <>
              {tab === "Research" && !detail && (
                <>
                  <div className="summary-strip">
                    <div>
                      <strong>
                        {state.companies.filter((c) => c.snapshot).length}
                        <span>/ 10</span>
                      </strong>
                      <span>Companies with saved data</span>
                    </div>
                    <div>
                      <strong>{state.videos.length}</strong>
                      <span>Videos in your library</span>
                    </div>
                    <div>
                      <strong>
                        {
                          state.opinions.filter((o) => o.status === "approved")
                            .length
                        }
                      </strong>
                      <span>Reviewed expert views</span>
                    </div>
                    <div>
                      <strong>
                        {state.gate.reviewed}
                        <span>/ 30</span>
                      </strong>
                      <span>
                        Extraction checks{state.gate.enabled ? " · passed" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="research-grid">
                    <section className="panel scorecard">
                      <div className="panel-header">
                        <div>
                          <h2>Company scorecard</h2>
                          <p>Real observations. No blended investment score.</p>
                        </div>
                        <span className="badge">{rows.length} companies</span>
                      </div>
                      <div className="toolbar">
                        <input
                          aria-label="Search companies"
                          placeholder="Search symbol, company or sector"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <select
                          aria-label="Filter companies"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All companies</option>
                          <option value="watchlist">My watchlist</option>
                          <option value="shariah">Verified Shariah</option>
                        </select>
                      </div>
                      <div className="table-scroll">
                        <table className="stock-table">
                          <thead>
                            <tr>
                              <th aria-label="Compare" />
                              <th>
                                <button onClick={() => sortBy("symbol")}>
                                  Company ↕
                                </button>
                              </th>
                              {[
                                ["price", "Price · PKR"],
                                ["pe", "P/E · TTM"],
                                ["eps", "Annual EPS"],
                                ["return", "1Y price return"],
                              ].map(([key, label]) => (
                                <th key={key}>
                                  <button onClick={() => sortBy(key)}>
                                    {label} ↕
                                  </button>
                                </th>
                              ))}
                              <th aria-label="Watchlist" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((c) => (
                              <tr key={c.symbol}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Compare ${c.symbol}`}
                                    checked={selected.includes(c.symbol)}
                                    onChange={() => toggle(c.symbol)}
                                  />
                                </td>
                                <td>
                                  <button
                                    className="company-link"
                                    onClick={() => setDetail(c.symbol)}
                                  >
                                    {c.symbol}
                                    <span>{c.name}</span>
                                  </button>
                                </td>
                                <td>{fmt(c.snapshot?.price)}</td>
                                <td>
                                  {fmt(c.snapshot?.pe)}
                                  {c.snapshot?.pe != null && (
                                    <span className="unit">x</span>
                                  )}
                                </td>
                                <td>{fmt(metric(c, "eps"))}</td>
                                <td
                                  className={
                                    (c.snapshot?.priceReturn ?? 0) < 0
                                      ? "negative"
                                      : c.snapshot?.priceReturn != null
                                        ? "positive"
                                        : ""
                                  }
                                >
                                  {c.snapshot?.priceReturn != null
                                    ? `${fmt(c.snapshot.priceReturn)}%`
                                    : "—"}
                                </td>
                                <td>
                                  <button
                                    className={`star ${c.watched ? "saved" : ""}`}
                                    aria-label={`${c.watched ? "Remove" : "Add"} ${c.symbol} ${c.watched ? "from" : "to"} watchlist`}
                                    disabled={pending}
                                    onClick={() =>
                                      action("watchlist", {
                                        symbol: c.symbol,
                                        watched: !c.watched,
                                      })
                                    }
                                  >
                                    {c.watched ? "★" : "☆"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!rows.length && (
                        <div className="empty">
                          No companies match. Unverified Shariah classifications
                          are excluded from this filter.
                        </div>
                      )}
                      <div className="table-note">
                        Price returns exclude dividends. Financial periods and
                        source dates are available on each company page.
                      </div>
                    </section>
                    <section className="panel chat-panel">
                      <div className="panel-header">
                        <div>
                          <span className="assistant-mark" aria-hidden="true">
                            ✧
                          </span>
                          <h2>Ask your research desk</h2>
                          <p>Answers grounded in your saved evidence.</p>
                        </div>
                      </div>
                      <div className="chat-body">
                        {!answer && (
                          <>
                            <p className="chat-intro">
                              What would you like to understand?
                            </p>
                            {[
                              "Compare OGDC and PPL: valuation, earnings and gaps.",
                              "What do experts disagree about in my shortlist?",
                              "What evidence is missing for a dividend investment?",
                            ].map((q) => (
                              <button
                                className="suggestion"
                                key={q}
                                onClick={() => setQuestion(q)}
                              >
                                {q}
                              </button>
                            ))}
                            <div className="evidence-note">
                              {state.aiConfigured
                                ? "AI is connected. Only relevant saved evidence is sent to the provider."
                                : "Connect an OpenAI API key in .env.local to enable AI. Company research and imports work without it."}
                            </div>
                          </>
                        )}
                        {answer && (
                          <div className="answer">
                            {(
                              [
                                ["Reported facts", answer.facts],
                                ["Expert views", answer.expertViews],
                              ] as const
                            ).map(([label, items]) => (
                              <section key={label}>
                                <h3>{label}</h3>
                                {items.length ? (
                                  items.map((item, i) => (
                                    <p key={i}>
                                      {item.text}
                                      <span className="citations">
                                        {item.evidenceIds.map((id) => {
                                          const c = answer.citations.find(
                                            (c) => c.evidenceId === id,
                                          );
                                          return (
                                            c && (
                                              <a
                                                key={id}
                                                href={c.url}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                {c.label}
                                              </a>
                                            )
                                          );
                                        })}
                                      </span>
                                    </p>
                                  ))
                                ) : (
                                  <p className="muted">
                                    No supporting evidence in the selected
                                    context.
                                  </p>
                                )}
                              </section>
                            ))}
                            <h3>Interpretation</h3>
                            <p>{answer.interpretation}</p>
                            <h3>Data gaps</h3>
                            <ul>
                              {answer.gaps.map((g, i) => (
                                <li key={i}>{g}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <form className="chat-form" onSubmit={chat}>
                        <label htmlFor="question">
                          {selected.length
                            ? `Research context: ${selected.join(", ")}`
                            : "Ask about a company or select up to four"}
                        </label>
                        <textarea
                          id="question"
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder="Ask a research question…"
                          maxLength={1500}
                          required
                          minLength={3}
                        />
                        <button className="primary" disabled={asking}>
                          {asking
                            ? "Reading the evidence…"
                            : "Ask with sources"}
                        </button>
                      </form>
                    </section>
                  </div>
                  <section className="panel compare">
                    <div className="panel-header">
                      <div>
                        <h2>Side by side</h2>
                        <p>Select up to four companies from the scorecard.</p>
                      </div>
                      {selected.length > 0 && (
                        <button
                          className="text-button"
                          onClick={() => setSelected([])}
                        >
                          Clear selection
                        </button>
                      )}
                    </div>
                    {chosen.length ? (
                      <div className="comparison-grid">
                        {chosen.map((c) => (
                          <div className="comparison" key={c.symbol}>
                            <h3>{c.symbol}</h3>
                            <p>{c.name}</p>
                            <dl>
                              {[
                                ["price", "Price · PKR"],
                                ["pe", "P/E · TTM"],
                                ["eps", "Annual EPS · PKR"],
                                ["margin", "Net profit margin · %"],
                              ].map(([k, l]) => (
                                <div key={k}>
                                  <dt>{l}</dt>
                                  <dd>{fmt(metric(c, k))}</dd>
                                </div>
                              ))}
                              <div>
                                <dt>Debt / equity</dt>
                                <dd>Unavailable</dd>
                              </div>
                              <div>
                                <dt>Shariah</dt>
                                <dd>
                                  {c.classification?.status || "Unverified"}
                                </dd>
                              </div>
                            </dl>
                            <small>Retrieved {date(c.retrieved_at)}</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="compare-empty">
                        <span aria-hidden="true">▥</span>
                        <p>
                          Your comparison starts with a question.
                          <br />
                          <span>
                            Select the companies you want to understand.
                          </span>
                        </p>
                      </div>
                    )}
                  </section>
                  <section className="panel consensus">
                    <div className="panel-header">
                      <div>
                        <h2>Expert perspectives</h2>
                        <p>
                          Latest approved view per speaker. Popularity is not a
                          measure of skill.
                        </p>
                      </div>
                      <label>
                        Since{" "}
                        <input
                          aria-label="Consensus start date"
                          type="date"
                          value={since}
                          onChange={(e) => setSince(e.target.value)}
                        />
                      </label>
                    </div>
                    {state.gate.enabled ? (
                      <div className="consensus-grid">
                        {state.companies.map((c) => (
                          <div key={c.symbol}>
                            <strong>{c.symbol}</strong>
                            <p>
                              {c.consensus?.bullish || 0} bullish ·{" "}
                              {c.consensus?.bearish || 0} bearish ·{" "}
                              {c.consensus?.neutral || 0} neutral
                            </p>
                            <small>{c.consensus?.sample || 0} speakers</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="gate">
                        <span aria-hidden="true">◎</span>
                        <div>
                          <strong>
                            Consensus is waiting for an accuracy check.
                          </strong>
                          <p>
                            Review at least 30 extracted passages with 90%
                            correct company and stance matching.{" "}
                            {state.gate.reviewed} checked
                            {state.gate.reviewed
                              ? `, ${fmt(state.gate.accuracy * 100)}% correct`
                              : ""}
                            .
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setTab("Opinion review")}
                          >
                            Open opinion review
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}
              {company && tab === "Research" && (
                <>
                  <div className="company-banner">
                    <div>
                      <span className="badge">
                        {company.sector || "Awaiting PSX validation"}
                      </span>
                      <h2>
                        {company.snapshot
                          ? `PKR ${fmt(company.snapshot.price)}`
                          : "No saved quote"}
                      </h2>
                      <p>
                        Source quote date:{" "}
                        {company.snapshot?.priceDate || "Unavailable"}
                      </p>
                      <p>Retrieved {date(company.retrieved_at)}</p>
                    </div>
                    <div>
                      <a
                        href={`https://dps.psx.com.pk/company/${company.symbol}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open official PSX source ↗
                      </a>
                      <button
                        className="primary"
                        disabled={pending}
                        onClick={() =>
                          action("refresh", { symbols: [company.symbol] })
                        }
                      >
                        Refresh {company.symbol}
                      </button>
                    </div>
                  </div>
                  {company.retrieved_at &&
                    Date.now() - Date.parse(company.retrieved_at) >
                      3 * 86400000 && (
                      <div className="alert">
                        This snapshot is more than three days old. Refresh
                        before relying on its quote.
                      </div>
                    )}
                  {company.snapshot ? (
                    <>
                      <FinancialTable
                        title="Annual financials"
                        t={company.snapshot.annual}
                      />
                      <FinancialTable
                        title="Quarterly financials"
                        t={company.snapshot.quarterly}
                      />
                      <FinancialTable
                        title="Reported ratios"
                        t={company.snapshot.ratios}
                      />
                      <section className="panel padded">
                        <h2>Payouts</h2>
                        {company.snapshot.payouts.length ? (
                          <ul>
                            {company.snapshot.payouts.map((p, i) => (
                              <li key={i}>
                                {p.date}: {p.description}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>
                            No payout records available in this snapshot.
                            Dividend yield and payout consistency are not
                            inferred.
                          </p>
                        )}
                        <h3>Data notes</h3>
                        <ul>
                          {company.snapshot.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </section>
                      <section className="panel padded">
                        <h2>Announcements</h2>
                        {company.snapshot.announcements.length ? (
                          company.snapshot.announcements.map((a, i) => (
                            <a
                              className="announcement"
                              key={i}
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span>{a.date}</span>
                              {a.title} ↗
                            </a>
                          ))
                        ) : (
                          <p>No announcements retrieved.</p>
                        )}
                      </section>
                    </>
                  ) : (
                    <div className="empty">
                      Refresh this company to collect real observations.
                    </div>
                  )}
                  <section className="panel padded">
                    <h2>Reviewed commentary</h2>
                    {state.opinions
                      .filter(
                        (o) =>
                          o.symbol === company.symbol &&
                          o.status === "approved",
                      )
                      .map((o) => (
                        <article className="opinion" key={o.id}>
                          <span className="badge">{o.stance}</span>
                          <strong>{o.speaker}</strong>
                          <p>{o.rationale}</p>
                          <blockquote dir="auto">{o.quote}</blockquote>
                          <a
                            href={`${o.url}${o.start_seconds !== null ? `&t=${Math.floor(o.start_seconds)}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {o.title} ↗
                          </a>
                          <small>
                            {date(o.published_at)}
                            {o.start_seconds === null
                              ? " · Untimed transcript"
                              : ""}
                          </small>
                        </article>
                      ))}
                    {!state.opinions.some(
                      (o) =>
                        o.symbol === company.symbol && o.status === "approved",
                    ) && <p>No approved expert views yet.</p>}
                  </section>
                </>
              )}
              {tab === "Video library" && (
                <div className="library-grid">
                  <section className="panel padded">
                    <h2>Import a transcript</h2>
                    <p>
                      Use a real video URL and publication date. Captions can be
                      in Urdu, English or both.
                    </p>
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const f = new FormData(form);
                        const file = f.get("file") as File;
                        if (
                          file?.size &&
                          (!/\.(txt|srt|vtt)$/i.test(file.name) ||
                            file.size > 500000)
                        ) {
                          setError(
                            "Upload a TXT, SRT or VTT file under 500 KB.",
                          );
                          return;
                        }
                        const text = file?.size
                          ? await file.text()
                          : String(f.get("text") || "");
                        const ok = await action("import", {
                          url: f.get("url"),
                          title: f.get("title"),
                          speaker: f.get("speaker"),
                          published_at: f.get("published_at"),
                          language: f.get("language"),
                          source_id: f.get("source_id")
                            ? Number(f.get("source_id"))
                            : null,
                          text,
                        });
                        if (ok) form.reset();
                      }}
                    >
                      <label>
                        Video URL
                        <input
                          name="url"
                          type="url"
                          placeholder="https://www.youtube.com/watch?v=…"
                          required
                        />
                      </label>
                      <label>
                        Video title
                        <input name="title" required maxLength={200} />
                      </label>
                      <div className="form-row">
                        <label>
                          Speaker
                          <input name="speaker" required maxLength={100} />
                        </label>
                        <label>
                          Published on
                          <input
                            name="published_at"
                            type="date"
                            required
                            max={today()}
                          />
                        </label>
                      </div>
                      <div className="form-row">
                        <label>
                          Source
                          <select name="source_id">
                            <option value="">Independent video</option>
                            {state.sources.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Language
                          <select name="language">
                            <option value="mixed">Urdu / English</option>
                            <option value="ur">Urdu</option>
                            <option value="en">English</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Transcript
                        <textarea
                          name="text"
                          rows={8}
                          placeholder="Paste transcript text, or upload a file below."
                          maxLength={120000}
                        />
                      </label>
                      <label>
                        Or upload TXT, SRT or VTT
                        <input
                          name="file"
                          type="file"
                          accept=".txt,.srt,.vtt"
                        />
                      </label>
                      <small>
                        Supplied timestamps are preserved. Plain text stays
                        untimed.
                      </small>
                      <button className="primary" disabled={pending}>
                        Import transcript
                      </button>
                    </form>
                  </section>
                  <section>
                    <div className="panel padded">
                      <h2>Your video library</h2>
                      {state.videos.length ? (
                        state.videos.map((v) => (
                          <article className="video" key={v.id}>
                            <span className="badge">
                              {v.status.replaceAll("_", " ")}
                            </span>
                            <h3>
                              <a href={v.url} target="_blank" rel="noreferrer">
                                {v.title} ↗
                              </a>
                            </h3>
                            <p>
                              {v.speaker} · {date(v.published_at)}
                            </p>
                            {v.error && <p className="negative">{v.error}</p>}
                            {v.status === "imported" && (
                              <button
                                className="secondary"
                                disabled={pending}
                                onClick={() => action("extract", { id: v.id })}
                              >
                                Extract opinions
                              </button>
                            )}
                          </article>
                        ))
                      ) : (
                        <div className="empty compact">
                          No videos yet. Import a transcript or discover videos
                          from a verified source.
                        </div>
                      )}
                    </div>
                    <div className="panel padded">
                      <h2>Automatic caption collection</h2>
                      <p>
                        Enabled channels are checked automatically every six
                        hours while the app is running. New captions are saved
                        with timestamps. Unavailable captions are retried daily.
                      </p>
                      {state.sources.map((s) => (
                        <div className="source-row" key={s.id}>
                          <div>
                            <strong>{s.name}</strong>
                            <small>
                              {s.kind === "institutional"
                                ? "Institutional context"
                                : "Expert commentary"}{" "}
                              ·{" "}
                              {s.verified_at
                                ? "Identity verified"
                                : "Identity not verified yet"}
                            </small>
                            <small>
                              {s.enabled
                                ? `Last checked: ${s.last_checked_at ? date(s.last_checked_at) : "Waiting for worker"}`
                                : "Automatic collection paused"}
                            </small>
                            {s.enabled && s.next_check_at && (
                              <small>Next check: {date(s.next_check_at)}</small>
                            )}
                            {s.last_error && (
                              <small className="negative">{s.last_error}</small>
                            )}
                          </div>
                          <button
                            className="secondary"
                            disabled={pending || !s.enabled}
                            onClick={() =>
                              action("discover", { source_id: s.id })
                            }
                          >
                            Check now
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
              {tab === "Opinion review" && (
                <>
                  <div className="alert">
                    Accuracy check: {state.gate.reviewed}/30 assessed ·{" "}
                    {fmt(state.gate.accuracy * 100)}% correct. Consensus{" "}
                    {state.gate.enabled ? "enabled" : "disabled"}.
                  </div>
                  <section className="panel padded">
                    {state.opinions.length ? (
                      state.opinions.map((o) => (
                        <article className="review-row" key={o.id}>
                          <div>
                            <span className="badge">{o.status}</span>
                            <strong>{o.symbol}</strong>
                            <span>
                              {o.speaker} · {o.stance}
                            </span>
                            <blockquote dir="auto">{o.quote}</blockquote>
                            <p>{o.rationale}</p>
                            <a
                              href={`${o.url}${o.start_seconds !== null ? `&t=${Math.floor(o.start_seconds)}` : ""}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Verify original video ↗
                            </a>
                            <small>
                              {o.correct === null
                                ? "Not assessed"
                                : o.correct
                                  ? "Extraction matched human reference"
                                  : "Extraction needed correction"}
                              {o.hypothetical ? " · Hypothetical example" : ""}
                            </small>
                          </div>
                          <button
                            className="secondary"
                            onClick={() => setReview(o)}
                          >
                            Review passage
                          </button>
                        </article>
                      ))
                    ) : (
                      <div className="empty">
                        No extracted opinions yet. Import a transcript and
                        connect an API key to begin extraction.
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === "Activity" && (
                <section className="panel padded">
                  <div className="panel-header">
                    <h2>Ingestion activity</h2>
                    <span className="badge">
                      {state.workerOnline ? "Worker online" : "Worker offline"}
                    </span>
                  </div>
                  {!state.workerOnline && (
                    <div className="alert">
                      Start the app with npm run dev to launch both the app and
                      its worker.
                    </div>
                  )}
                  {state.jobs.length ? (
                    state.jobs.map((j) => (
                      <article className="job" key={j.id}>
                        <div>
                          <span
                            className={`badge ${j.status === "failed" ? "red" : ""}`}
                          >
                            {j.status}
                          </span>
                          <strong>
                            #{j.id} {j.type}
                          </strong>
                          <p>{j.progress}</p>
                          {j.error && <p className="negative">{j.error}</p>}
                          <small>{date(j.updated_at)}</small>
                        </div>
                        {j.status === "failed" && (
                          <button
                            className="secondary"
                            disabled={pending}
                            onClick={() => action("retry", { id: j.id })}
                          >
                            Retry job
                          </button>
                        )}
                      </article>
                    ))
                  ) : (
                    <div className="empty">
                      No jobs yet. Refresh PSX data or import a video
                      transcript.
                    </div>
                  )}
                </section>
              )}
              {tab === "Settings" && (
                <div className="library-grid">
                  <section className="panel padded">
                    <div className="panel-header">
                      <h2>Research sources</h2>
                      <button
                        className="secondary"
                        onClick={() =>
                          setSource({
                            id: 0,
                            name: "",
                            url: "https://www.youtube.com/channel/",
                            channel_id: null,
                            enabled: 1,
                            kind: "expert",
                            verified_at: null,
                          })
                        }
                      >
                        Add source
                      </button>
                    </div>
                    {state.sources.map((s) => (
                      <div className="source-row" key={s.id}>
                        <div>
                          <strong>{s.name}</strong>
                          <small>{s.url}</small>
                          <small>
                            {s.channel_id || "Channel ID unresolved"} ·{" "}
                            {s.enabled ? "Enabled" : "Disabled"}
                          </small>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => setSource(s)}
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                    <h3>AI and storage</h3>
                    <p>
                      {state.aiConfigured
                        ? "OpenAI key configured on the server."
                        : "OpenAI key not configured. Set OPENAI_API_KEY in .env.local and restart."}
                    </p>
                    <p>
                      Monthly spend: ${fmt(state.budget.used)} / $10.
                      Reservations remain held when a provider timeout leaves
                      billing uncertain.
                    </p>
                    <p>
                      Research data stays in the local database. Relevant
                      evidence is sent to OpenAI when extracting opinions or
                      asking questions.
                    </p>
                    <a href="/api/export?format=markdown">
                      Export research as Markdown
                    </a>
                  </section>
                  <section className="panel padded">
                    <h2>Shariah classification</h2>
                    <p>
                      Record a classification only after checking a dated
                      official PSX source. Entries older than 180 days become
                      unverified.
                    </p>
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        await action("classification", {
                          symbol: f.get("symbol"),
                          status: f.get("status"),
                          as_of: f.get("as_of"),
                          source_url: f.get("source_url"),
                          confirmed: true,
                        });
                      }}
                    >
                      <label>
                        Company
                        <select name="symbol">
                          {state.companies.map((c) => (
                            <option key={c.symbol}>{c.symbol}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Classification
                        <select name="status">
                          <option value="compliant">Compliant</option>
                          <option value="noncompliant">Noncompliant</option>
                        </select>
                      </label>
                      <label>
                        Official classification date
                        <input
                          name="as_of"
                          type="date"
                          required
                          max={today()}
                        />
                      </label>
                      <label>
                        Official PSX source URL
                        <input
                          name="source_url"
                          type="url"
                          required
                          placeholder="https://www.psx.com.pk/…"
                        />
                      </label>
                      <label className="check-label">
                        <input type="checkbox" required /> I checked this
                        company against the dated official source.
                      </label>
                      <button className="primary" disabled={pending}>
                        Save classification
                      </button>
                    </form>
                  </section>
                </div>
              )}
            </>
          )}
          <footer>
            Personal research, with sources attached. Check issuer filings
            before making an investment decision.
            <span>Pakistan Standard Time</span>
          </footer>
        </div>
      </main>
      {review && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
          >
            <button
              className="close"
              aria-label="Close review"
              onClick={() => setReview(null)}
            >
              ×
            </button>
            <h2 id="review-title">Review the original passage</h2>
            <blockquote dir="auto">{review.quote}</blockquote>
            <p className="muted">
              Original extraction: {review.extracted_symbol} ·{" "}
              {review.extracted_stance}
            </p>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const symbol = String(f.get("symbol")),
                  stance = String(f.get("stance"));
                const ok = await action("review", {
                  id: review.id,
                  symbol,
                  speaker: f.get("speaker"),
                  stance,
                  rationale: f.get("rationale"),
                  target: String(f.get("target") || "") || null,
                  horizon: String(f.get("horizon") || "") || null,
                  hypothetical: f.get("hypothetical") === "on",
                  status: f.get("decision"),
                  expected_symbol: symbol,
                  expected_stance: stance,
                  evaluate: f.get("evaluate") === "on",
                });
                if (ok) setReview(null);
              }}
            >
              <div className="form-row">
                <label>
                  Correct company
                  <select name="symbol" defaultValue={review.symbol}>
                    {state?.companies.map((c) => (
                      <option key={c.symbol}>{c.symbol}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Correct stance
                  <select name="stance" defaultValue={review.stance}>
                    <option value="bullish">Bullish</option>
                    <option value="bearish">Bearish</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </label>
              </div>
              <label>
                Speaker
                <input name="speaker" defaultValue={review.speaker} required />
              </label>
              <label>
                Rationale
                <textarea
                  name="rationale"
                  defaultValue={review.rationale}
                  required
                />
              </label>
              <div className="form-row">
                <label>
                  Explicit target
                  <input name="target" defaultValue={review.target || ""} />
                </label>
                <label>
                  Explicit horizon
                  <input name="horizon" defaultValue={review.horizon || ""} />
                </label>
              </div>
              <label className="check-label">
                <input
                  name="hypothetical"
                  type="checkbox"
                  defaultChecked={!!review.hypothetical}
                />{" "}
                This is a hypothetical or educational example
              </label>
              <label className="check-label">
                <input name="evaluate" type="checkbox" /> I checked the original
                passage; use my corrected company and stance as the accuracy
                reference
              </label>
              <label>
                Decision
                <select
                  name="decision"
                  defaultValue={review.hypothetical ? "rejected" : "approved"}
                >
                  <option value="approved">Approve for research</option>
                  <option value="rejected">Reject</option>
                </select>
              </label>
              <button className="primary" disabled={pending}>
                Save review
              </button>
            </form>
          </section>
        </div>
      )}
      {source && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
          >
            <button
              className="close"
              aria-label="Close source editor"
              onClick={() => setSource(null)}
            >
              ×
            </button>
            <h2 id="source-title">Edit research source</h2>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const ok = await action("sources", {
                  ...(source.id ? { id: source.id } : {}),
                  name: f.get("name"),
                  url: f.get("url"),
                  channel_id: String(f.get("channel_id") || "") || null,
                  kind: f.get("kind"),
                  enabled: f.get("enabled") === "on",
                });
                if (ok) setSource(null);
              }}
            >
              <label>
                Source name
                <input name="name" defaultValue={source.name} required />
              </label>
              <label>
                Official source or channel page
                <input
                  name="url"
                  type="url"
                  defaultValue={source.url}
                  required
                />
              </label>
              <label>
                YouTube channel ID
                <input
                  name="channel_id"
                  defaultValue={source.channel_id || ""}
                  placeholder="UC…"
                />
              </label>
              <label>
                Source role
                <select name="kind" defaultValue={source.kind}>
                  <option value="expert">Expert commentary</option>
                  <option value="institutional">Institutional context</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={!!source.enabled}
                />{" "}
                Automatically collect this channel’s captions
              </label>
              <button className="primary" disabled={pending}>
                Save source
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
