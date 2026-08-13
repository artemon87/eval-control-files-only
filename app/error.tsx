"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("EvalHub render failure", error);
  }, [error]);

  return (
    <main className="error-state">
      <span>!</span>
      <h1>We couldn’t load the evaluation dashboard</h1>
      <p>The current view failed safely. Retry it without losing server-side evaluation data.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
