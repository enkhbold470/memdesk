import type { Config } from "./config.ts";
import { ocrImage } from "./ocr.ts";
import { markFailed, resolveProviders, type Provider, type ResolveOpts } from "./provider.ts";
import type { Analysis } from "./types.ts";
import { analyzeImage, parseVisionContent } from "./vision.ts";

export interface AnalyzeActivityOpts {
  provider: Provider;
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
    provider,
    app,
    title,
    ocrText,
    timeoutMs = 30_000,
    retries = 1,
    fetchImpl = fetch,
  } = opts;
  const { baseUrl, apiKey, model } = provider;

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    max_tokens: 200,
    temperature: 0.2,
    ...provider.extraBody,
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
      return { summary, tags, model, provider: provider.name };
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
 *
 * Tries each resolved provider in order. A local failure falls through to
 * cloud and marks local unhealthy, so one broken model doesn't cost an entry
 * every minute for the rest of the day.
 */
export async function runAnalysis(
  cfg: Config,
  imagePath: string,
  app: string | null,
  title: string | null,
  ocrBinary: string | null,
  resolveOpts: ResolveOpts = {},
): Promise<Analysis> {
  const needsVision = cfg.analysisMode === "vision";
  const providers = await resolveProviders(cfg, { ...resolveOpts, needsVision });
  if (providers.length === 0) {
    throw new Error(
      needsVision
        ? "no multimodal provider available (start Ollama with a vision model, or set cloud credentials in .env)"
        : "no provider available (start Ollama, or set OPENAI_BASE_URL / OPENAI_API_KEY / VISION_MODEL in .env)",
    );
  }

  // OCR once, outside the provider loop — it's local work and provider-independent.
  let ocrText = "";
  if (!needsVision) {
    if (!ocrBinary) {
      throw new Error("OCR helper unavailable — needs swiftc (Xcode Command Line Tools)");
    }
    ocrText = await ocrImage(ocrBinary, imagePath);
  }

  let lastErr: unknown;
  for (const [i, provider] of providers.entries()) {
    // Don't spend the retry budget on a provider that has a fallback behind
    // it — reaching the fallback quickly matters more than retrying this one.
    const retries = i === providers.length - 1 ? 1 : 0;
    try {
      return needsVision
        ? await analyzeImage({ imagePath, provider, app, title, retries })
        : await analyzeActivity({ provider, app, title, ocrText, retries });
    } catch (e) {
      lastErr = e;
      markFailed(provider.name, e instanceof Error ? e.message : String(e), resolveOpts);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
