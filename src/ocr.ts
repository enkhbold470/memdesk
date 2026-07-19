import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";

export const OCR_MAX_CHARS = 6000;

function binPath(cfg: Config): string {
  return join(cfg.rootDir, "ocr", "memdesk-ocr");
}
function srcPath(cfg: Config): string {
  return join(cfg.rootDir, "ocr", "ocr.swift");
}

/**
 * Ensure the compiled macOS Vision OCR helper exists, building it from
 * ocr/ocr.swift on first use. Returns the binary path, or null if swiftc is
 * unavailable or compilation fails (caller records this as an analysis error).
 */
export async function ensureOcrBinary(cfg: Config): Promise<string | null> {
  const bin = binPath(cfg);
  if (existsSync(bin)) return bin;

  const swiftc = Bun.which("swiftc");
  if (!swiftc) return null;
  if (!existsSync(srcPath(cfg))) return null;

  const proc = Bun.spawn([swiftc, "-O", srcPath(cfg), "-o", bin], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = (await new Response(proc.stderr).text()).trim();
    console.error(`[memdesk] OCR helper failed to compile: ${err}`);
    return null;
  }
  return existsSync(bin) ? bin : null;
}

/** Collapse runs of blank lines / trailing whitespace and cap length. */
function normalize(text: string, maxChars: number): string {
  const cleaned = text
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0)
    .join("\n")
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/** Run the OCR helper on an image and return the recognized text. */
export async function ocrImage(
  binaryPath: string,
  imagePath: string,
  maxChars = OCR_MAX_CHARS,
): Promise<string> {
  const proc = Bun.spawn([binaryPath, imagePath], { stdout: "pipe", stderr: "pipe" });
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) {
    const err = (await new Response(proc.stderr).text()).trim();
    throw new Error(`OCR failed (exit ${code})${err ? `: ${err}` : ""}`);
  }
  return normalize(text, maxChars);
}
