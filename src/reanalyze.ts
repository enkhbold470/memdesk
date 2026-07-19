import { existsSync } from "node:fs";
import { join } from "node:path";
import { runAnalysis } from "./analyze.ts";
import { hasVisionCreds, loadConfig } from "./config.ts";
import { ensureOcrBinary } from "./ocr.ts";
import { dayKey, readDay, rewriteDay } from "./store.ts";

/**
 * Re-run vision on a day's "active" entries that have no analysis but whose
 * screenshot PNG still exists on disk. Rewrites the day file in place.
 */
if (import.meta.main) {
  const cfg = loadConfig();
  if (!hasVisionCreds(cfg)) {
    console.error("[memdesk] no vision credentials — cannot reanalyze. Fill in .env.");
    process.exit(1);
  }
  const day = process.argv[2] ?? dayKey();
  const entries = await readDay(cfg, day);
  const ocrBinary = cfg.analysisMode === "vision" ? null : await ensureOcrBinary(cfg);

  let fixed = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.status !== "active" || e.analysis || !e.screenshot) continue;
    const abs = join(cfg.rootDir, e.screenshot);
    if (!existsSync(abs)) {
      skipped++;
      continue;
    }
    try {
      e.analysis = await runAnalysis(cfg, abs, e.app, e.title, ocrBinary);
      delete e.error;
      fixed++;
      console.log(`  ✓ ${e.ts.slice(11, 16)} → ${e.analysis.summary}`);
    } catch (err) {
      e.error = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${e.ts.slice(11, 16)} → ${e.error}`);
    }
  }

  await rewriteDay(cfg, day, entries);
  console.log(`\n[memdesk] reanalyzed ${day}: ${fixed} fixed, ${skipped} skipped (PNG purged).`);
}
