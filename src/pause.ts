import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";

export function pausedFlagPath(cfg: Config): string {
  return join(cfg.rootDir, "PAUSED");
}

export function isPaused(cfg: Config): boolean {
  return existsSync(pausedFlagPath(cfg));
}

export async function setPaused(cfg: Config, value: boolean): Promise<void> {
  const path = pausedFlagPath(cfg);
  if (value) {
    await writeFile(path, `paused ${new Date().toISOString()}\n`, "utf8");
  } else if (existsSync(path)) {
    await unlink(path);
  }
}

// CLI: `bun run src/pause.ts on|off`
if (import.meta.main) {
  const arg = (process.argv[2] ?? "on").toLowerCase();
  const cfg = loadConfig();
  const on = arg === "on" || arg === "true" || arg === "pause";
  await setPaused(cfg, on);
  console.log(on ? "[memdesk] paused — capture suspended." : "[memdesk] resumed — capture active.");
}
