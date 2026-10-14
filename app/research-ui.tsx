"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

export function Modal({
  title,
  children,
  close,
  className = "",
  closeLabel = "Close preview",
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  className?: string;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.isConnected && previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      className={`expert-modal ${className}`}
      aria-label={title}
    >
      <div className="section-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label={closeLabel}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function PageControls({
  page,
  total,
  onChange,
  label,
}: {
  page: number;
  total: number;
  onChange: (p: number) => void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / 25));
  useEffect(() => {
    if (page >= pages) onChange(pages - 1);
  }, [page, pages, onChange]);
  if (total <= 25) return null;
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span>
        {page * 25 + 1}–{Math.min(total, (page + 1) * 25)} of {total}
      </span>
      <button
        aria-label={`Previous ${label} page`}
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <button
        aria-label={`Next ${label} page`}
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
export function StockPicker({
  stocks,
  value,
  onChange,
  label = "Stock",
  empty = "All stocks and topics",
}: {
  stocks: { symbol: string; name?: string; aliases?: string }[];
  value: string;
  onChange: (s: string) => void;
  label?: string;
  empty?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const matches = stocks
    .filter((s) =>
      `${s.symbol} ${s.name || ""} ${s.aliases || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 25);
  return (
    <div className="stock-picker">
      <span className="field-label">{label}</span>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span>{value || empty}</span>
        <Search size={14} aria-hidden="true" />
      </button>
      {open && (
        <Modal
          title={`Choose ${label.toLowerCase()}`}
          close={() => setOpen(false)}
          className="stock-dialog"
        >
          <label>
            Search stocks
            <input
              type="search"
              name="stock-search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Symbol or company name…"
            />
          </label>
          <div className="stock-results">
            {query && !matches.length && (
              <p role="status">
                No stocks match. Try a symbol or company name.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {empty}
            </button>
            {matches.map((s) => (
              <button
                type="button"
                key={s.symbol}
                onClick={() => {
                  onChange(s.symbol);
                  setOpen(false);
                }}
              >
                <strong>{s.symbol}</strong>
                <span>{s.name}</span>
              </button>
            ))}
          </div>
          <p className="muted">
            Showing up to 25 matches. Refine your search for more.
          </p>
        </Modal>
      )}
    </div>
  );
}
export function ReadableError({ message }: { message: string }) {
  const technical =
    message.trim().startsWith("[") ||
    message.includes('"path"') ||
    message.includes("[YoutubeTranscript]");
  return technical ? (
    <>
      <p>
        The source or analysis could not be processed. Your saved evidence is
        retained.
      </p>
      <details>
        <summary>Technical details</summary>
        <pre>{message}</pre>
      </details>
    </>
  ) : (
    <p>{message}</p>
  );
}
