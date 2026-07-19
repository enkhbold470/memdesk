import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { mergeConfig } from "./config.ts";
import {
  appendEntry,
  dayKey,
  hhmmss,
  listDays,
  localISO,
  purgeOldScreenshots,
  readDay,
  rewriteDay,
} from "./store.ts";
import type { Entry } from "./types.ts";

let root: string;
let cfg: Config;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "memdesk-store-"));
  cfg = mergeConfig(root, {}, {});
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(ts: string, over: Partial<Entry> = {}): Entry {
  return { ts, app: "Code", title: "x", status: "active", screenshot: null, analysis: null, ...over };
}

describe("append/read", () => {
  test("round-trips entries for a day", async () => {
    await appendEntry(cfg, entry("2026-07-18T09:00:00-07:00"));
    await appendEntry(cfg, entry("2026-07-18T09:01:00-07:00", { status: "idle" }));
    const day = await readDay(cfg, "2026-07-18");
    expect(day).toHaveLength(2);
    expect(day[0]!.status).toBe("active");
    expect(day[1]!.status).toBe("idle");
  });

  test("missing day reads as empty", async () => {
    expect(await readDay(cfg, "2000-01-01")).toEqual([]);
  });

  test("listDays returns newest-first", async () => {
    await appendEntry(cfg, entry("2026-07-16T09:00:00-07:00"));
    await appendEntry(cfg, entry("2026-07-18T09:00:00-07:00"));
    expect(await listDays(cfg)).toEqual(["2026-07-18", "2026-07-16"]);
  });

  test("rewriteDay overwrites in place", async () => {
    await appendEntry(cfg, entry("2026-07-18T09:00:00-07:00"));
    const day = await readDay(cfg, "2026-07-18");
    day[0]!.analysis = { summary: "did a thing", tags: ["x"], model: "m" };
    await rewriteDay(cfg, "2026-07-18", day);
    const again = await readDay(cfg, "2026-07-18");
    expect(again).toHaveLength(1);
    expect(again[0]!.analysis?.summary).toBe("did a thing");
  });
});

describe("purgeOldScreenshots", () => {
  test("removes only folders older than retentionDays; JSON untouched", async () => {
    const now = new Date("2026-07-18T12:00:00");
    cfg.retentionDays = 14;

    const old = dayKey(new Date("2026-07-01T00:00:00")); // 17 days back
    const recent = dayKey(new Date("2026-07-17T00:00:00")); // 1 day back
    await mkdir(join(cfg.screenshotsDir, old), { recursive: true });
    await writeFile(join(cfg.screenshotsDir, old, "120000.png"), "x");
    await mkdir(join(cfg.screenshotsDir, recent), { recursive: true });
    await writeFile(join(cfg.screenshotsDir, recent, "120000.png"), "x");
    await appendEntry(cfg, entry(`${old}T12:00:00-07:00`));

    const removed = await purgeOldScreenshots(cfg, now);
    expect(removed).toBe(1);
    expect(existsSync(join(cfg.screenshotsDir, old))).toBe(false);
    expect(existsSync(join(cfg.screenshotsDir, recent))).toBe(true);
    // history for the purged day still readable
    expect(await readDay(cfg, old)).toHaveLength(1);
  });

  test("no screenshots dir → 0", async () => {
    expect(await purgeOldScreenshots(cfg, new Date())).toBe(0);
  });
});

describe("time helpers", () => {
  test("dayKey / hhmmss / localISO format a fixed local date", () => {
    const d = new Date(2026, 6, 18, 9, 3, 7); // local
    expect(dayKey(d)).toBe("2026-07-18");
    expect(hhmmss(d)).toBe("090307");
    expect(localISO(d)).toMatch(/^2026-07-18T09:03:07[+-]\d\d:\d\d$/);
  });
});
