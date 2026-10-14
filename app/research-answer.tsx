"use client";
import type { ExpertEvidence } from "@/lib/expert";
import {
  date,
  stamp,
  evidenceText,
  type Answer,
  type Claim,
} from "./expert-shared";
export default function ResearchAnswer({
  answer,
  setEvidence,
}: {
  answer: Answer;
  setEvidence: (e: ExpertEvidence | null) => void;
}) {
  return (
    <div className="expert-answer">
      <p>
        <strong>Evidence cutoff:</strong> {date(answer.cutoff)} · AI-generated,
        not human-reviewed
      </p>
      {answer.coverage && (
        <p className="muted">
          {answer.coverage.discovered} discovered videos · {answer.coverage.indexed} indexed · {answer.coverage.missing} missing transcripts · Discovery {answer.coverage.complete ? "complete" : "incomplete"} for this period
        </p>
      )}
      {answer.retrieval?.fallbackReason && <p className="muted">{answer.retrieval.fallbackReason}</p>}
      {(
        [
          ["What was said", answer.whatWasSaid],
          ["Changes in position", answer.changes],
          ["Disagreements", answer.disagreements],
        ] as [string, Claim[]][]
      ).map(([title, claims]) => (
        <section key={title}>
          <h3>{title}</h3>
          {claims.length ? (
            claims.map((c, i) => (
              <div key={i}>
                <p>{c.text}</p>
                {c.evidenceIds.map((id) => (
                  <button
                    className="citation-button"
                    key={id}
                    onClick={() =>
                      setEvidence(
                        answer.evidence.find((e) => e.id === id) || null,
                      )
                    }
                  >
                    Inspect {id} ·{" "}
                    {answer.evidence.find((e) => e.id === id)?.channel} ·{" "}
                    {date(
                      answer.evidence.find((e) => e.id === id)?.date || null,
                    )}
                  </button>
                ))}
              </div>
            ))
          ) : (
            <p className="no-conclusion">
              No supported conclusion in the retrieved evidence.
            </p>
          )}
        </section>
      ))}
      <h3>AI interpretation</h3>
      <p>{answer.interpretation}</p>
      <h3>Evidence gaps</h3>
      <ul>
        {answer.gaps.map((g, i) => (
          <li key={i}>{g}</li>
        ))}
      </ul>
      <h3>Retrieved passages</h3>
      {answer.evidence.map((e) => (
        <button
          className="evidence-result"
          key={e.id}
          onClick={() => setEvidence(e)}
        >
          <strong>
            {e.channel} · {date(e.date)}
          </strong>
          <span>
            {e.title} · {stamp(e.start_seconds)}
          </span>
          <span>{evidenceText(e).slice(0, 240)}…</span>
        </button>
      ))}
    </div>
  );
}
