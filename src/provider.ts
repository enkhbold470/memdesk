import type { Config } from "./config.ts";

/** Which backend answered (or should answer) a request. */
export type ProviderName = "local" | "cloud";

export interface Provider {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** False for text-only local models — they're skipped in "vision" analysisMode. */
  supportsVision: boolean;
  /** Extra fields merged into every /chat/completions body. */
  extraBody: Record<string, unknown>;
}

/** Ollama's native API root, i.e. the OpenAI base URL without its trailing /v1. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** The cloud (arkor) provider, or null when its credentials are incomplete. */
export function cloudProvider(cfg: Config): Provider | null {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return null;
  return {
    name: "cloud",
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    supportsVision: true,
    extraBody: {},
  };
}

/** The local (Ollama) provider. */
export function localProvider(cfg: Config, supportsVision: boolean): Provider {
  return {
    name: "local",
    baseUrl: cfg.localBaseUrl,
    // Ollama ignores authorization; a placeholder keeps the request shape identical.
    apiKey: "ollama",
    model: cfg.localModel,
    supportsVision,
    // gemma4 is a thinking model. Without this it spends the entire max_tokens
    // budget on reasoning tokens and returns empty content, so every analysis
    // fails with "no text content in response".
    extraBody: { reasoning_effort: "none" },
  };
}

export interface LocalStatus {
  /** The model is present AND actually able to serve a chat completion. */
  ok: boolean;
  supportsVision: boolean;
  /** Human-readable reason, for `bun run check`. */
  detail: string;
}

/**
 * Ask Ollama about the configured model.
 *
 * Deliberately uses /api/show rather than /v1/models: a pruned model still
 * appears in the model list but fails every request, which is exactly the
 * failure that would otherwise silently lose an entry every minute.
 */
export async function probeLocal(
  cfg: Config,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<LocalStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${ollamaRoot(cfg.localBaseUrl)}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.localModel }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, supportsVision: false, detail: `${cfg.localModel} unavailable (HTTP ${res.status})` };
    }
    const json = (await res.json()) as { capabilities?: unknown };
    const caps = Array.isArray(json.capabilities) ? json.capabilities.map(String) : [];
    if (!caps.includes("completion")) {
      return {
        ok: false,
        supportsVision: false,
        detail: `${cfg.localModel} cannot serve chat (capabilities: ${caps.join(", ") || "none"})`,
      };
    }
    return { ok: true, supportsVision: caps.includes("vision"), detail: `${cfg.localModel} ready` };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "timed out" : String(e);
    return { ok: false, supportsVision: false, detail: `Ollama unreachable at ${cfg.localBaseUrl} (${msg})` };
  } finally {
    clearTimeout(timer);
  }
}

export interface Health {
  /**
   * Cached local probe, so an all-day daemon doesn't probe on every call.
   * The probe reads a manifest — it does not load the model into memory.
   */
  probe: { validUntil: number; status: LocalStatus | null };
  /**
   * Epoch ms until which a provider stays demoted after a real request failed.
   * Without this, an offline laptop would burn the cloud timeout on every
   * single tick before reaching the local fallback.
   */
  failedUntil: Record<ProviderName, number>;
}

export function newHealth(): Health {
  return { probe: { validUntil: 0, status: null }, failedUntil: { local: 0, cloud: 0 } };
}

/** Module-level default so callers don't have to thread state through. */
const defaultHealth = newHealth();

export interface ResolveOpts {
  /** Vision mode needs a multimodal model. */
  needsVision?: boolean;
  fetchImpl?: typeof fetch;
  health?: Health;
  ttlMs?: number;
  now?: number;
}

/**
 * Ordered list of providers to try, best first.
 *
 * cfg.provider pins the choice ("local"/"cloud"); "auto" uses cloud first and
 * keeps local as the fallback, so the local model is only ever loaded when the
 * cloud endpoint is actually unreachable. More than one entry means the caller
 * should fall through on failure.
 */
export async function resolveProviders(cfg: Config, opts: ResolveOpts = {}): Promise<Provider[]> {
  const {
    needsVision = false,
    fetchImpl = fetch,
    health = defaultHealth,
    ttlMs = 60_000,
    now = Date.now(),
  } = opts;

  const cloud = cloudProvider(cfg);
  if (cfg.provider === "cloud") return cloud ? [cloud] : [];

  let status = health.probe.status;
  if (!status || now >= health.probe.validUntil) {
    status = await probeLocal(cfg, fetchImpl);
    health.probe.status = status;
    health.probe.validUntil = now + ttlMs;
  }

  const localUsable = status.ok && (!needsVision || status.supportsVision);
  const local = localUsable ? localProvider(cfg, status.supportsVision) : null;
  if (cfg.provider === "local") return local ? [local] : [];

  // Cloud first; anything that recently failed a real request goes last rather
  // than being dropped, so a total outage still gets attempted.
  const ordered = [cloud, local].filter((p): p is Provider => p !== null);
  const healthy = ordered.filter((p) => health.failedUntil[p.name] <= now);
  const demoted = ordered.filter((p) => health.failedUntil[p.name] > now);
  return [...healthy, ...demoted];
}

/**
 * Demote a provider for the rest of the TTL after a real request failed.
 * A probe can pass while requests still fail, so the request is the authority.
 */
export function markFailed(name: ProviderName, _reason: string, opts: ResolveOpts = {}): void {
  const { health = defaultHealth, ttlMs = 60_000, now = Date.now() } = opts;
  health.failedUntil[name] = now + ttlMs;
}
