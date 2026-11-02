"use client";

import { useEffect, useState } from "react";
import type { EvalApi, RunListFilters } from "./eval-api";
import type { EvalRun, EvalType } from "./eval-types";

export function useRunCollection(
  api: EvalApi | null,
  filters: RunListFilters,
  active = true,
  evalType: "all" | EvalType = "all",
) {
  const queryKey = JSON.stringify({ filters, evalType });
  const [state, setState] = useState<{
    key: string;
    runs: EvalRun[];
    error: string | null;
    loaded: boolean;
  }>({ key: "", runs: [], error: null, loaded: false });

  useEffect(() => {
    if (!api || !active) return;
    const controller = new AbortController();
    const query = JSON.parse(queryKey) as {
      filters: RunListFilters;
      evalType: "all" | EvalType;
    };
    void api
      .listRunCollection(query.filters, controller.signal, query.evalType)
      .then((runs) => {
        if (!controller.signal.aborted)
          setState({ key: queryKey, runs, error: null, loaded: true });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key: queryKey,
            runs: [],
            loaded: true,
            error:
              error instanceof Error ? error.message : "Unable to load runs",
          });
      });
    return () => controller.abort();
  }, [api, active, queryKey]);

  return {
    ...state,
    loading: active && (!api || state.key !== queryKey),
  };
}
