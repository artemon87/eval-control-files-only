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

  dataStateRequest = Promise.resolve().then(async () => {
    const api = configuredEvalApi();
    if (!api) return "unconfigured";

    try {
      await api.listRunBatch(undefined, 1);
      return "live";
    } catch {
      return "error";
    }
  });

  return dataStateRequest.then((state) => {
    cachedDataState = state;
    dataStateRequest = null;
    return state;
  });
}

export function SidebarFooter({
  dataState: suppliedDataState,
}: {
  dataState?: SidebarDataState;
}) {
  const [detectedDataState, setDetectedDataState] =
    useState<SidebarDataState>(
      suppliedDataState ?? cachedDataState ?? "connecting",
    );

  useEffect(() => {
    if (suppliedDataState) {
      cachedDataState = suppliedDataState;
      return;
    }

    let active = true;
    void detectDataState().then((state) => {
      if (active) setDetectedDataState(state);
    });

    return () => {
      active = false;
    };
  }, [suppliedDataState]);

  const dataState = suppliedDataState ?? detectedDataState;

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
