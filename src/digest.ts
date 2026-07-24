import { loadConfig, type Config } from "./config.ts";
import { markFailed, resolveProviders, type Provider, type ResolveOpts } from "./provider.ts";
import { dayKey, readDay, writeSummary } from "./store.ts";
import type { DaySummary, Entry } from "./types.ts";

/** Minutes → "3h20m" / "45m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
}

/**
 * Time spent per app, counting each entry as one interval-minute. Idle and
 * excluded minutes still count as presence in that app. Sorted desc by time.
 */
export function computeAppTime(entries: Entry[], minutesPerEntry = 1): Record<string, string> {
  const mins = new Map<string, number>();
  for (const e of entries) {
    if (!e.app) continue;
    mins.set(e.app, (mins.get(e.app) ?? 0) + minutesPerEntry);
  }
  const sorted = [...mins.entries()].sort((a, b) => b[1] - a[1]);
  const out: Record<string, string> = {};
  for (const [app, m] of sorted) out[app] = formatDuration(m);
  return out;
}

/** Build the compact text log of active summaries fed to the model. */
export function buildDigestPrompt(entries: Entry[]): string {
  const lines = entries
    .filter((e) => e.status === "active" && e.analysis?.summary)
    .map((e) => `${e.ts.slice(11, 16)} [${e.app ?? "?"}] ${e.analysis!.summary}`);
  return lines.join("\n");
}

const DIGEST_SYSTEM =
  "You are given a timestamped log of what a person did on their computer today. " +
  "Write a short reflective summary of their day and list concrete things they shipped or accomplished. " +
  'Reply with ONLY JSON: {"narrative": "<2-4 sentences>", "shipped": ["<concrete item>", ...]}.';

interface SummarizeResult {
  narrative: string;
  shipped: string[];
}

/** Call the endpoint (text-only) to narrate the day. Throws on failure. */
export async function summarizeDay(
  provider: Provider,
  logText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SummarizeResult> {
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 500,
      temperature: 0.3,
      ...provider.extraBody,
      messages: [
        { role: "system", content: DIGEST_SYSTEM },
        { role: "user", content: logText || "(no recorded activity)" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no content in digest response");

  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1) text = text.slice(s, e + 1);
  const obj = JSON.parse(text) as { narrative?: unknown; shipped?: unknown };
  return {
    narrative: String(obj.narrative ?? "").trim(),
    shipped: Array.isArray(obj.shipped) ? obj.shipped.map((x) => String(x).trim()).filter(Boolean) : [],
  };
}

/** Generate and persist a day's summary. Returns it. */
export async function generateDigest(
  cfg: Config,
  day: string,
  resolveOpts: ResolveOpts = {},
): Promise<DaySummary> {
  const entries = await readDay(cfg, day);
  const appTime = computeAppTime(entries, cfg.intervalSec / 60);

  // The digest follows the same auto-selection as per-minute analysis.
  const providers = await resolveProviders(cfg, resolveOpts);
  let narrative = "";
  let shipped: string[] = [];
  if (providers.length === 0) {
    narrative = "(no provider available — app time only)";
  } else {
    const prompt = buildDigestPrompt(entries);
    let lastErr: unknown;
    for (const provider of providers) {
      try {
        const r = await summarizeDay(provider, prompt);
        narrative = r.narrative;
        shipped = r.shipped;
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        markFailed(provider.name, e instanceof Error ? e.message : String(e), resolveOpts);
      }
    }
    if (lastErr) {
      narrative = `(summary unavailable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`;
    }
  }

  const summary: DaySummary = {
    date: day,
    narrative,
    shipped,
    appTime,
    generatedAt: new Date().toISOString(),
  };
  await writeSummary(cfg, summary);
  return summary;
}

if (import.meta.main) {
  const cfg = loadConfig();
  const day = process.argv[2] ?? dayKey();
  const summary = await generateDigest(cfg, day);
  console.log(`\n=== ${summary.date} ===`);
  console.log(summary.narrative || "(no narrative)");
  if (summary.shipped.length) {
    console.log("\nShipped:");
    for (const s of summary.shipped) console.log(`  • ${s}`);
  }
  console.log("\nTime by app:");
  for (const [app, t] of Object.entries(summary.appTime)) console.log(`  ${app}: ${t}`);
  console.log(`\nSaved → data/${day}.summary.json`);
}
