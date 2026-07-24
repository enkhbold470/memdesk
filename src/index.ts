import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runAnalysis } from "./analyze.ts";
import { captureScreen, CaptureError, isBlank, PERMISSION_HINT } from "./capture.ts";
import { averageHash, isChanged } from "./changedetect.ts";
import { loadConfig, type Config } from "./config.ts";
import { getContext, isExcluded } from "./context.ts";
import { ensureOcrBinary } from "./ocr.ts";
import { isPaused } from "./pause.ts";
import { resolveProviders } from "./provider.ts";
import { appendEntry, dayKey, hhmmss, localISO, purgeOldScreenshots } from "./store.ts";
import type { Analysis, Entry } from "./types.ts";

interface LoopState {
  lastHash: bigint | null;
  ticks: number;
  warnedPermission: boolean;
  /** Resolved OCR helper path; undefined = not yet resolved, null = unavailable. */
  ocrBinary: string | null | undefined;
}

/** One capture cycle. Never throws — a failure logs and is recorded, but the loop survives. */
export async function tick(cfg: Config, state: LoopState): Promise<void> {
  const now = new Date();
  const ts = localISO(now);

  if (isPaused(cfg)) return;

  const { app, title } = await getContext();

  // Sensitive app in focus → skip capture entirely.
  if (isExcluded(app, cfg.excludeApps)) {
    await appendEntry(cfg, { ts, app, title, status: "excluded", screenshot: null, analysis: null });
    return;
  }

  const day = dayKey(now);
  const dir = join(cfg.screenshotsDir, day);
  await mkdir(dir, { recursive: true });
  const filename = `${hhmmss(now)}.png`;
  const outPath = join(dir, filename);
  const relPath = `screenshots/${day}/${filename}`;

  try {
    await captureScreen(outPath, { display: cfg.display });
  } catch (e) {
    if (e instanceof CaptureError && !state.warnedPermission) {
      console.error(`[memdesk] capture failed: ${e.message}\n${PERMISSION_HINT}`);
      state.warnedPermission = true;
    }
    return;
  }

  // Blank frame (screen off / no permission): don't waste an API call or 14 days of disk.
  if (await isBlank(outPath)) {
    if (!state.warnedPermission) {
      console.error(PERMISSION_HINT);
      state.warnedPermission = true;
    }
    await unlink(outPath).catch(() => {});
    await appendEntry(cfg, { ts, app, title, status: "idle", screenshot: null, analysis: null });
    return;
  }

  let hash: bigint | null;
  try {
    hash = await averageHash(outPath);
  } catch {
    hash = null; // undecodable → treat as changed so we still record it
  }

  const changed = hash === null ? true : isChanged(state.lastHash, hash, cfg.changeThreshold);
  if (!changed) {
    await unlink(outPath).catch(() => {});
    await appendEntry(cfg, { ts, app, title, status: "idle", screenshot: null, analysis: null });
    return;
  }
  if (hash !== null) state.lastHash = hash;

  // Provider availability is decided per tick inside runAnalysis, so Ollama
  // starting or stopping mid-day is picked up without a restart.
  let analysis: Analysis | null = null;
  let error: string | undefined;
  try {
    if (cfg.analysisMode !== "vision" && state.ocrBinary === undefined) {
      state.ocrBinary = await ensureOcrBinary(cfg);
    }
    analysis = await runAnalysis(cfg, outPath, app, title, state.ocrBinary ?? null);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const entry: Entry = { ts, app, title, status: "active", screenshot: relPath, analysis };
  if (error) entry.error = error;
  await appendEntry(cfg, entry);
}

async function maybePurge(cfg: Config, state: LoopState): Promise<void> {
  // Once at startup, then roughly hourly.
  const perHour = Math.max(1, Math.round(3600 / cfg.intervalSec));
  if (state.ticks % perHour !== 0) return;
  try {
    const removed = await purgeOldScreenshots(cfg);
    if (removed > 0) console.log(`[memdesk] purged ${removed} day-folder(s) older than ${cfg.retentionDays}d`);
  } catch (e) {
    console.warn(`[memdesk] purge failed: ${String(e)}`);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const state: LoopState = { lastHash: null, ticks: 0, warnedPermission: false, ocrBinary: undefined };

  console.log(
    `[memdesk] capturing the ${cfg.display === "main" ? "main" : `#${cfg.display}`} display ` +
      `every ${cfg.intervalSec}s (${cfg.analysisMode} mode) → ${cfg.dataDir}`,
  );

  const providers = await resolveProviders(cfg, { needsVision: cfg.analysisMode === "vision" });
  if (providers.length === 0) {
    console.warn(
      "[memdesk] no provider reachable — recording app/title only. " +
        "Start Ollama, or fill in .env to enable AI summaries.",
    );
  } else {
    console.log(
      `[memdesk] provider: ${cfg.provider} → ${providers.map((p) => `${p.name}(${p.model})`).join(" then ")}`,
    );
  }
  console.log(PERMISSION_HINT);

  let running = true;
  const stop = () => {
    running = false;
    console.log("\n[memdesk] stopping…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    const started = Date.now();
    await maybePurge(cfg, state);
    try {
      await tick(cfg, state);
    } catch (e) {
      console.error(`[memdesk] tick error: ${String(e)}`);
    }
    state.ticks++;

    // Sleep the remainder of the interval, staying responsive to shutdown.
    const elapsed = Date.now() - started;
    let remaining = Math.max(0, cfg.intervalSec * 1000 - elapsed);
    while (running && remaining > 0) {
      const chunk = Math.min(500, remaining);
      await Bun.sleep(chunk);
      remaining -= chunk;
    }
  }
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
