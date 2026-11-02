"use client";
import { useEffect, useRef, useState } from "react";
import type { EvalApi } from "./eval-api";
import type { FixedTimeWindow } from "./time-window";

/** Freeze the backend's UTC anchor across scope/range changes; refresh starts a new one. */
export function useHistoryWindow(
  api: EvalApi | null,
  range: "7d" | "30d" | "90d",
  revision: number,
  refresh: number,
) {
  const session = JSON.stringify([revision, refresh]);
  const key = JSON.stringify([range, session]);
  const anchor = useRef<{ session: string; end: string } | null>(null);
  const [state, setState] = useState<{
    key: string;
    window: FixedTimeWindow | null;
    error: string | null;
  }>({ key: "", window: null, error: null });
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    void api
      .getHistoryWindow(
        range,
        anchor.current?.session === session ? anchor.current.end : undefined,
        controller.signal,
      )
      .then((window) => {
        if (controller.signal.aborted) return;
        anchor.current = { session, end: window.startedBefore };
        setState({ key, window, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            window: null,
            error:
              error instanceof Error
                ? error.message
                : "Unable to resolve History window",
          });
      });
    return () => controller.abort();
  }, [api, key, session, range]);
  return {
    window: state.key === key ? state.window : null,
    error: state.key === key ? state.error : null,
    loading: state.key !== key,
  };
}
