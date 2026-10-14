"use client";
import { useEffect, useRef } from "react";
import { Plus, ArrowUpRight, ChevronDown } from "lucide-react";
import type { Channel } from "./expert-shared";
import { ReadableError } from "./research-ui";
export default function ChannelRail({
  channels,
  selected,
  toggle,
  open,
  add,
  act,
  busy,
}: {
  channels: Channel[];
  selected: number[];
  toggle: (id: number) => void;
  open: (id: number) => void;
  add: () => void;
  act: (p: string, b: unknown) => Promise<void>;
  busy: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width:1023px)");
    const update = () => {
      if (ref.current) ref.current.open = !media.matches;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <aside className="channel-rail" aria-label="Followed channels">
      <details ref={ref} className="channel-selector" open>
        <summary>
          <span>Followed channels</span>
          <ChevronDown size={16} />
        </summary>
        <div className="rail-content">
          <div className="rail-heading">
            <span className="eyebrow">YOUR SOURCES · {channels.length}</span>
            <button
              className="icon-button"
              aria-label="Add Channel"
              onClick={add}
            >
              <Plus size={18} />
            </button>
          </div>
          {!channels.length && (
            <div className="empty">
              <p>Start with a voice you trust.</p>
              <button onClick={add}>Add Channel</button>
            </div>
          )}
          {channels.map((c) => (
            <article className="channel-row" key={c.id}>
              <label className="channel-select">
                <input
                  type="checkbox"
                  aria-label={`Ask ${c.name}`}
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.handle || "YouTube channel"}</small>
                </span>
              </label>
              <p className="channel-stats">
                {c.indexed} indexed <span>· {c.analyzed} analyzed</span>
              </p>
              <span
                className={`status-label ${c.paused || !c.enabled ? "paused" : ""}`}
              >
                {c.paused || !c.enabled
                  ? "Paused"
                  : c.discovery_complete
                    ? "Discovery complete"
                    : "Discovery incomplete"}
              </span>
              <button className="rail-link" onClick={() => open(c.id)}>
                Insights & timeline <ArrowUpRight size={14} />
              </button>
              <details className="coverage-details">
                <summary>Coverage & collection</summary>
                <p>
                  {c.since
                    ? `${c.since} → ${c.until}`
                    : "History has not been collected"}
                </p>
                <dl className="coverage">
                  {[
                    ["Discovered", c.discovered],
                    ["Saved", c.saved],
                    ["Indexed", c.indexed],
                    ["Analyzed", c.analyzed],
                    ["Captions missing", c.missing],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {c.last_error && <ReadableError message={c.last_error} />}
                <div className="expert-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(
                        c.paused || !c.enabled
                          ? "channels/resume"
                          : "channels/sync",
                        { source_id: c.id },
                      )
                    }
                  >
                    {c.paused || !c.enabled ? "Resume" : "Sync history"}
                  </button>
                  <button
                    disabled={busy || !c.enabled}
                    onClick={() =>
                      void act("channels/pause", { source_id: c.id })
                    }
                  >
                    Pause
                  </button>
                </div>
              </details>
            </article>
          ))}
          <button className="add-channel" onClick={add}>
            <Plus size={15} /> Add Channel
          </button>
          <p className="rail-note">
            Captions are collected when available. Coverage gaps remain visible.
          </p>
        </div>
      </details>
    </aside>
  );
}
