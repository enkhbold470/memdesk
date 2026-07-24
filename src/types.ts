/** Shared data shapes for memdesk. */

export type EntryStatus = "active" | "idle" | "excluded";

export interface Analysis {
  /** One concise sentence describing what the user was doing. */
  summary: string;
  /** 1-3 short lowercase keyword tags. */
  tags: string[];
  /** The model that produced this analysis. */
  model: string;
  /**
   * Which backend produced it. Recorded per entry because in "auto" mode the
   * choice varies minute to minute — this is how you audit whether a given
   * minute's screen text stayed on the machine or went to the cloud.
   */
  provider: "local" | "cloud";
}

export interface Entry {
  /** Local ISO timestamp with offset, e.g. 2026-07-18T12:03:00-07:00. */
  ts: string;
  /** Frontmost app name, or null if unavailable. */
  app: string | null;
  /** Frontmost window title, or null if unavailable. */
  title: string | null;
  status: EntryStatus;
  /** Repo-relative path to the PNG, or null (idle / excluded / no capture). */
  screenshot: string | null;
  /** Vision result, or null (idle, excluded, or a failed/ pending analysis). */
  analysis: Analysis | null;
  /** Present only when a capture or analysis failed. */
  error?: string;
  /**
   * Fabricated demo data, not a real recording of anyone's screen. Set only
   * by `bun run demo`. The flag lives in the data itself so a synthetic entry
   * can never be mistaken for a real one, whatever the UI happens to show.
   */
  synthetic?: true;
}

export interface DaySummary {
  date: string;
  narrative: string;
  shipped: string[];
  /** Human-readable time per app, e.g. { "Code": "3h20m" }. */
  appTime: Record<string, string>;
  generatedAt: string;
  /** See Entry.synthetic. */
  synthetic?: true;
}
