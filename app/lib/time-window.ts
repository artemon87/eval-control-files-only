export type TimeWindowPreset = "24h" | "7d" | "30d" | "90d";

const PRESET_MILLISECONDS: Record<TimeWindowPreset, number> = {
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
  "90d": 90 * 24 * 60 * 60 * 1_000,
};

export type FixedTimeWindow = {
  startedFrom: string;
  startedBefore: string;
};

export function fixedTimeWindow(
  preset: TimeWindowPreset,
  now = new Date(),
): FixedTimeWindow {
  const end = now.getTime();
  return {
    startedFrom: new Date(end - PRESET_MILLISECONDS[preset]).toISOString(),
    startedBefore: now.toISOString(),
  };
}
