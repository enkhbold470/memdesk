import type { Config } from "./config.ts";
import { ocrImage } from "./ocr.ts";
import type { Analysis } from "./types.ts";
import { analyzeImage, parseVisionContent } from "./vision.ts";

export interface AnalyzeActivityOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
  app: string | null;
  title: string | null;
  ocrText: string;
  timeoutMs?: number;
  retries?: number;
  /** Injectable for testing. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT =
  "You are given the frontmost app, the window title, and the visible on-screen text " +
  "(from OCR) of a user's computer screen at one moment. Infer what the user is doing. " +
  'Reply with ONLY a JSON object on one line, no prose, no code fences: ' +
  '{"summary": "<one concise sentence describing what the user is doing>", ' +
  '"tags": ["<1-3 short lowercase keyword tags>"]}.';

/** Build the string user-message content (this endpoint rejects array content). */
export function buildActivityPrompt(app: string | null, title: string | null, ocrText: string): string {
  return (
    `App: ${app ?? "unknown"}\n` +
    `Window title: ${title ?? "unknown"}\n` +
    `On-screen text (OCR):\n${ocrText || "(none detected)"}`
  );
}

/**
 * Describe activity from app/title + OCR text via a text-only
 * /chat/completions call (string content). Retries once; throws on failure.
 */
export async function analyzeActivity(opts: AnalyzeActivityOpts): Promise<Analysis> {
  const {
    baseUrl,
    apiKey,
    model,
    app,
    title,
    ocrText,
    timeoutMs = 30_000,
    retries = 1,
    fetchImpl = fetch,
  } = opts;

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    max_tokens: 200,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildActivityPrompt(app, title, ocrText) },
    ],
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("no text content in response");
      const { summary, tags } = parseVisionContent(content);
      if (!summary) throw new Error("empty summary in response");
      return { summary, tags, model };
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Analyze one capture according to the configured mode.
 * - "ocr"    → OCR the image locally, then summarize the text (image stays local).
 * - "vision" → send the image to a multimodal endpoint.
 * `ocrBinary` is the resolved OCR helper path (null when unavailable).
 */
export async function runAnalysis(
  cfg: Config,
  imagePath: string,
  app: string | null,
  title: string | null,
  ocrBinary: string | null,
): Promise<Analysis> {
  if (cfg.analysisMode === "vision") {
    return analyzeImage({
      imagePath,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      app,
      title,
    });
  }
  if (!ocrBinary) {
    throw new Error("OCR helper unavailable — needs swiftc (Xcode Command Line Tools)");
  }
  const ocrText = await ocrImage(ocrBinary, imagePath);
  return analyzeActivity({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    app,
    title,
    ocrText,
  });
}
