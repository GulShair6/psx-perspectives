"use client";
import { useEffect, useState } from "react";
import { api, type Data } from "./expert-shared";
import { AliasEditor } from "./expert-review";
import { ReadableError } from "./research-ui";
export default function ResearchSettings({
  state,
}: {
  state: {
    aiConfigured: boolean;
    aiProvider: string;
    aiModel: string;
  };
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let canceled = false;
    const load = () =>
      api<Data>("channels")
        .then((d) => {
          if (!canceled) {
            setData(d);
            setError("");
          }
        })
        .catch(() => {
          if (!canceled)
            setError(
              "Could not load channel configuration. Saved settings are retained.",
            );
        });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, []);
  async function save(path: string, body: unknown) {
    setError("");
    setNotice("");
    try {
      await api(path, body);
      setNotice(
        path === "catalog/refresh"
          ? "Catalog refresh queued. Track its outcome in Activity."
          : "Aliases saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save configuration");
    }
  }
  return (
    <section className="panel padded">
      <h2>Configuration & storage</h2>
      <dl className="configuration-list">
        <div>
          <dt>Research model</dt>
          <dd>
            {state.aiConfigured
              ? `${state.aiProvider} · ${state.aiModel}`
              : "Not configured"}
          </dd>
        </div>
        <div>
          <dt>YouTube discovery</dt>
          <dd>
            {data
              ? data.youtubeConfigured
                ? "Configured"
                : "API key missing"
              : "Checking…"}
          </dd>
        </div>
      </dl>
      <p className="muted">
        Credentials stay in the server’s .env. Set OLLAMA_API_KEY for synthesis
        and YOUTUBE_DATA_API_KEY for channel discovery, then restart the app.
      </p>
      <p className="muted">
        Relevant saved evidence is sent to {state.aiProvider} for analysis.
        Saved transcripts and reviews stay in the local database.
      </p>
      <a href="/api/export?format=markdown">Export research as Markdown ↗</a>
      <details className="processing-panel">
        <summary>Stock catalog & bilingual aliases</summary>
        <p>
          Official symbols are separate from the company fundamentals dashboard.
        </p>
        <button onClick={() => void save("catalog/refresh", {})}>
          Refresh official symbols
        </button>
        <AliasEditor
          stocks={data?.catalog || []}
          save={(symbol, aliases) =>
            save("catalog/aliases", { symbol, aliases })
          }
        />
      </details>
      {error && (
        <div role="alert">
          <ReadableError message={error} />
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
