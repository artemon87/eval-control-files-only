"use client";

import { useEffect, useState } from "react";

import { configuredEvalApi } from "../lib/eval-api";
import { AuthControls } from "./auth-controls";

export type SidebarDataState =
  | "connecting"
  | "live"
  | "error"
  | "unconfigured";

let cachedDataState: SidebarDataState | undefined;
let dataStateRequest: Promise<SidebarDataState> | null = null;

function detectDataState() {
  if (cachedDataState) return Promise.resolve(cachedDataState);
  if (dataStateRequest) return dataStateRequest;

  const api = configuredEvalApi();
  if (!api) {
    cachedDataState = "unconfigured";
    return Promise.resolve(cachedDataState);
  }

  dataStateRequest = api
    .listRunBatch(undefined, 1)
    .then((): SidebarDataState => "live")
    .catch((): SidebarDataState => "error")
    .then((state) => {
      cachedDataState = state;
      return state;
    })
    .finally(() => {
      dataStateRequest = null;
    });

  return dataStateRequest;
}

function useDetectedDataState(enabled: boolean) {
  const [state, setState] = useState<SidebarDataState>(
    cachedDataState ?? "connecting",
  );

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    void detectDataState().then((nextState) => {
      if (active) setState(nextState);
    });

    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
}

export function SidebarFooter({
  dataState: suppliedDataState,
}: {
  dataState?: SidebarDataState;
}) {
  const detectedDataState = useDetectedDataState(!suppliedDataState);
  const dataState = suppliedDataState ?? detectedDataState;

  useEffect(() => {
    if (suppliedDataState) cachedDataState = suppliedDataState;
  }, [suppliedDataState]);

  return (
    <div className="sidebar-footer">
      <div className={`sidebar-note sidebar-note--${dataState}`}>
        <span>Data status</span>
        <strong>
          <i />{" "}
          {dataState === "live"
            ? "Live API connected"
            : dataState === "connecting"
              ? "Connecting to API"
              : dataState === "error"
                ? "API unavailable"
                : "API not configured"}
        </strong>
        <small>FastAPI · MongoDB · read only</small>
      </div>

      <AuthControls />
    </div>
  );
}
