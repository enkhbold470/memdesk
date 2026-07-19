import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { DaySummary, Entry } from "./types.ts";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local YYYY-MM-DD for a date. */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local HHMMSS for a date (screenshot filename stem). */
export function hhmmss(d: Date = new Date()): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Local ISO timestamp with timezone offset, e.g. 2026-07-18T12:03:00-07:00. */
export function localISO(d: Date = new Date()): string {
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

export function jsonlPath(cfg: Config, day: string): string {
  return join(cfg.dataDir, `${day}.jsonl`);
}

export function summaryPath(cfg: Config, day: string): string {
  return join(cfg.dataDir, `${day}.summary.json`);
}

/** Append one entry as a JSONL line. Creates the data dir on first write. */
export async function appendEntry(cfg: Config, entry: Entry): Promise<void> {
  await mkdir(cfg.dataDir, { recursive: true });
  const day = entry.ts.slice(0, 10);
  await appendFile(jsonlPath(cfg, day), `${JSON.stringify(entry)}\n`, "utf8");
}

/** Read all entries for a day, oldest-first. Missing day → []. */
export async function readDay(cfg: Config, day: string): Promise<Entry[]> {
  const path = jsonlPath(cfg, day);
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8");
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Entry);
    } catch {
      // skip a corrupt line rather than fail the whole day
    }
  }
  return out;
}

/** Overwrite a day's JSONL (used by reanalyze). */
export async function rewriteDay(cfg: Config, day: string, entries: Entry[]): Promise<void> {
  await mkdir(cfg.dataDir, { recursive: true });
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(jsonlPath(cfg, day), body ? `${body}\n` : "", "utf8");
}

/** List days that have history, newest-first. */
export async function listDays(cfg: Config): Promise<string[]> {
  if (!existsSync(cfg.dataDir)) return [];
  const names = await readdir(cfg.dataDir);
  return names
    .map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
}

export async function writeSummary(cfg: Config, summary: DaySummary): Promise<void> {
  await mkdir(cfg.dataDir, { recursive: true });
  await writeFile(summaryPath(cfg, summary.date), JSON.stringify(summary, null, 2), "utf8");
}

export async function readSummary(cfg: Config, day: string): Promise<DaySummary | null> {
  const path = summaryPath(cfg, day);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as DaySummary;
  } catch {
    return null;
  }
}

/**
 * Delete screenshot day-folders older than retentionDays. JSON is never
 * touched. Returns the number of folders removed.
 */
export async function purgeOldScreenshots(cfg: Config, now: Date = new Date()): Promise<number> {
  if (!existsSync(cfg.screenshotsDir)) return 0;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - cfg.retentionDays);
  const cutoffKey = dayKey(cutoff);

  let removed = 0;
  for (const name of await readdir(cfg.screenshotsDir)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    if (name < cutoffKey) {
      await rm(join(cfg.screenshotsDir, name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
