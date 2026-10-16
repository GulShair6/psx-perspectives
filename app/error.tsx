"use client";

export default function Error({ retry }: { retry: () => void }) {
  return (
    <main className="recovery-page">
      <h1>The workspace could not be displayed</h1>
      <p>
        Try opening it again. If this continues, restart the app and check the
        terminal for details.
      </p>
      <button className="primary" onClick={retry}>
        Try again
      </button>
    </main>
  );
}
