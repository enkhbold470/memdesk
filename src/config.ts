import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Resolved runtime configuration for memdesk. */
export interface Config {
  /** Seconds between captures. */
  intervalSec: number;
  /** Delete screenshot PNGs older than this many days. */
  retentionDays: number;
  /** Max Hamming distance between average-hashes still treated as "same frame". */
  changeThreshold: number;
  /** "main" for the primary monitor, or a numeric display id. */
  display: number | "main";
  /**
   * How to describe each frame:
   * - "ocr"    → OCR the screenshot locally, summarize the text (image never leaves the machine).
   * - "vision" → send the image to a multimodal endpoint.
   */
  analysisMode: "ocr" | "vision";
  /** Web UI port. */
  port: number;
  /** Frontmost apps for which capture is skipped entirely (case-insensitive substring). */
  excludeApps: string[];
  /**
   * Which backend analyzes frames:
   * - "auto"  → local (Ollama) when it can serve the model, cloud otherwise.
   * - "local" → Ollama only. Nothing leaves the machine.
   * - "cloud" → the hosted endpoint only.
   */
  provider: "auto" | "local" | "cloud";
  // --- cloud endpoint (from env) ---
  baseUrl: string;
  apiKey: string;
  model: string;
  // --- local endpoint (from env) ---
  localBaseUrl: string;
  localModel: string;
  // --- resolved paths ---
  rootDir: string;
  dataDir: string;
  screenshotsDir: string;
  webDir: string;
}

/** Subset of Config a user may override via config.json. */
export type FileConfig = Partial<
  Pick<
    Config,
    | "intervalSec"
    | "retentionDays"
    | "changeThreshold"
    | "display"
    | "analysisMode"
    | "port"
    | "excludeApps"
    | "provider"
  >
>;

export interface Env {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  VISION_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
}

export const DEFAULTS = {
  intervalSec: 60,
  retentionDays: 14,
  changeThreshold: 5,
  display: "main" as number | "main",
  analysisMode: "ocr" as "ocr" | "vision",
  port: 4319,
  excludeApps: ["1Password", "Messages"],
  provider: "auto" as "auto" | "local" | "cloud",
  localBaseUrl: "http://localhost:11434/v1",
  localModel: "gemma4:e2b",
};

/** Pure merge of defaults + config.json + env + resolved paths. Unit-testable. */
export function mergeConfig(rootDir: string, file: FileConfig, env: Env): Config {
  return {
    intervalSec: file.intervalSec ?? DEFAULTS.intervalSec,
    retentionDays: file.retentionDays ?? DEFAULTS.retentionDays,
    changeThreshold: file.changeThreshold ?? DEFAULTS.changeThreshold,
    display: file.display ?? DEFAULTS.display,
    analysisMode: file.analysisMode ?? DEFAULTS.analysisMode,
    port: file.port ?? DEFAULTS.port,
    excludeApps: file.excludeApps ?? DEFAULTS.excludeApps,
    provider: file.provider ?? DEFAULTS.provider,
    baseUrl: env.OPENAI_BASE_URL ?? "",
    apiKey: env.OPENAI_API_KEY ?? "",
    model: env.VISION_MODEL ?? "gemma-4-31B-it",
    localBaseUrl: env.OLLAMA_BASE_URL ?? DEFAULTS.localBaseUrl,
    localModel: env.OLLAMA_MODEL ?? DEFAULTS.localModel,
    rootDir,
    dataDir: join(rootDir, "data"),
    screenshotsDir: join(rootDir, "screenshots"),
    webDir: join(rootDir, "web"),
  };
}

/** The project root (directory containing src/). */
export function projectRoot(): string {
  return resolve(import.meta.dir, "..");
}

/** Load config from disk + environment. */
export function loadConfig(): Config {
  const rootDir = projectRoot();
  let file: FileConfig = {};
  const path = join(rootDir, "config.json");
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8")) as FileConfig;
    } catch (e) {
      console.warn(`[memdesk] ignoring invalid config.json: ${String(e)}`);
    }
  }
  return mergeConfig(rootDir, file, process.env as Env);
}

/** True when the cloud endpoint credentials are all present. */
export function hasCloudCreds(cfg: Config): boolean {
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model);
}
