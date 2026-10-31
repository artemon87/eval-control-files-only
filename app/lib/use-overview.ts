"use client";
import { useEffect, useState } from "react";
import type { EvalApi, RunListFilters } from "./eval-api";
import type { OverviewData } from "./overview";

export function useOverview(api: EvalApi | null, filters: RunListFilters, active: boolean) {
  const key = JSON.stringify(filters);
  const [state, setState] = useState<{api: EvalApi | null; key: string; data: OverviewData | null; error: string | null} | null>(null);
  useEffect(() => {
    if (!api || !active) return;
    const controller = new AbortController();
    void api.getOverview(JSON.parse(key), controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ api, key, data, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ api, key, data: null,
        error: error instanceof Error ? error.message : "Unable to load Overview" });
    });
    return () => controller.abort();
  }, [api, active, key]);
  const current = state?.key === key && state.api === api;
  return { data: current ? state.data : null, error: current ? state.error : null,
    loading: active && (!api || !current) };
}
