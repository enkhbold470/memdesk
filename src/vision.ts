import type { Analysis } from "./types.ts";

export interface AnalyzeOpts {
  imagePath: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  app: string | null;
  title: string | null;
  timeoutMs?: number;
  retries?: number;
  /** Injectable for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT =
  "You analyze a single screenshot of the user's computer screen. " +
  "Reply with ONLY a JSON object on one line, no prose, no code fences: " +
  '{"summary": "<one concise sentence describing what the user is doing>", ' +
  '"tags": ["<1-3 short lowercase keyword tags>"]}.';

/**
 * Extract {summary, tags} from a model reply that may be wrapped in prose or
 * code fences. Throws if no usable JSON object is found.
 */
export function parseVisionContent(content: string): { summary: string; tags: string[] } {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) text = text.slice(start, end + 1);

  const obj = JSON.parse(text) as { summary?: unknown; tags?: unknown };
  const summary = String(obj.summary ?? "").trim();
  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .map((t) => String(t).toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  return { summary, tags };
}

async function toDataUrl(imagePath: string): Promise<string> {
  const bytes = await Bun.file(imagePath).arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:image/png;base64,${b64}`;
}

/**
 * Describe a screenshot via an OpenAI-compatible /chat/completions endpoint.
 * Retries once on any failure; throws the last error if all attempts fail.
 */
export async function analyzeImage(opts: AnalyzeOpts): Promise<Analysis> {
  const {
    imagePath,
    baseUrl,
    apiKey,
    model,
    app,
    title,
    timeoutMs = 30_000,
    retries = 1,
    fetchImpl = fetch,
  } = opts;

  const dataUrl = await toDataUrl(imagePath);
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    max_tokens: 200,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Frontmost app: ${app ?? "unknown"}. Window: ${title ?? "unknown"}. Describe what the user is doing.`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
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
