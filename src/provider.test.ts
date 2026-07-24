import { describe, expect, test } from "bun:test";
import { mergeConfig, type Config } from "./config.ts";
import {
  markFailed,
  newHealth,
  ollamaRoot,
  probeLocal,
  resolveProviders,
} from "./provider.ts";

function cfgWith(over: Partial<Config> = {}): Config {
  return {
    ...mergeConfig("/root", {}, {
      OPENAI_BASE_URL: "https://cloud/v1",
      OPENAI_API_KEY: "k",
      VISION_MODEL: "gemma-4-31B-it",
    }),
    ...over,
  };
}

/** Fake /api/show returning the given capabilities. */
function showing(capabilities: string[] | null, status = 200) {
  return (async () =>
    ({
      ok: status === 200,
      status,
      async json() {
        return capabilities === null ? {} : { capabilities };
      },
      async text() {
        return "";
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("ollamaRoot", () => {
  test("strips a trailing /v1 and slashes", () => {
    expect(ollamaRoot("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(ollamaRoot("http://localhost:11434/v1/")).toBe("http://localhost:11434");
    expect(ollamaRoot("http://localhost:11434")).toBe("http://localhost:11434");
  });
});

describe("probeLocal", () => {
  test("ok when the model can serve completions", async () => {
    const s = await probeLocal(cfgWith(), showing(["completion", "vision", "tools"]));
    expect(s.ok).toBe(true);
    expect(s.supportsVision).toBe(true);
  });

  test("reports text-only models", async () => {
    const s = await probeLocal(cfgWith(), showing(["completion", "tools"]));
    expect(s.ok).toBe(true);
    expect(s.supportsVision).toBe(false);
  });

  test("not ok when the model lacks completion — a pruned model still lists but cannot answer", async () => {
    const s = await probeLocal(cfgWith(), showing(["tools", "thinking"]));
    expect(s.ok).toBe(false);
    expect(s.detail).toContain("cannot serve chat");
  });

  test("not ok when Ollama 404s the model", async () => {
    const s = await probeLocal(cfgWith(), showing(null, 404));
    expect(s.ok).toBe(false);
    expect(s.detail).toContain("unavailable");
  });

  test("not ok when Ollama is unreachable", async () => {
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const s = await probeLocal(cfgWith(), boom);
    expect(s.ok).toBe(false);
    expect(s.detail).toContain("unreachable");
  });
});

describe("resolveProviders", () => {
  const opts = (fetchImpl: typeof fetch, extra = {}) => ({
    fetchImpl,
    health: newHealth(),
    now: 1000,
    ...extra,
  });

  test("auto prefers cloud, keeping local as the fallback", async () => {
    const ps = await resolveProviders(cfgWith(), opts(showing(["completion", "vision"])));
    expect(ps.map((p) => p.name)).toEqual(["cloud", "local"]);
  });

  test("auto is cloud-only when local is down", async () => {
    const ps = await resolveProviders(cfgWith(), opts(showing(null, 404)));
    expect(ps.map((p) => p.name)).toEqual(["cloud"]);
  });

  test("auto is local-only when cloud has no credentials", async () => {
    const cfg = cfgWith({ baseUrl: "", apiKey: "", model: "" });
    const ps = await resolveProviders(cfg, opts(showing(["completion"])));
    expect(ps.map((p) => p.name)).toEqual(["local"]);
  });

  test("auto yields nothing when local is down and cloud has no credentials", async () => {
    const cfg = cfgWith({ baseUrl: "", apiKey: "", model: "" });
    const ps = await resolveProviders(cfg, opts(showing(null, 404)));
    expect(ps).toEqual([]);
  });

  test("local pin never falls back to cloud", async () => {
    const cfg = cfgWith({ provider: "local" });
    const up = await resolveProviders(cfg, opts(showing(["completion"])));
    expect(up.map((p) => p.name)).toEqual(["local"]);

    const down = await resolveProviders(cfg, opts(showing(null, 404)));
    expect(down).toEqual([]);
  });

  test("cloud pin never probes local", async () => {
    let probed = false;
    const spy = (async () => {
      probed = true;
      return showing(["completion"]);
    }) as unknown as typeof fetch;
    const ps = await resolveProviders(cfgWith({ provider: "cloud" }), opts(spy));
    expect(ps.map((p) => p.name)).toEqual(["cloud"]);
    expect(probed).toBe(false);
  });

  test("vision mode skips a text-only local model", async () => {
    const ps = await resolveProviders(
      cfgWith(),
      opts(showing(["completion", "tools"]), { needsVision: true }),
    );
    expect(ps.map((p) => p.name)).toEqual(["cloud"]);
  });

  test("vision mode keeps a multimodal local model as fallback", async () => {
    const ps = await resolveProviders(
      cfgWith(),
      opts(showing(["completion", "vision"]), { needsVision: true }),
    );
    expect(ps.map((p) => p.name)).toEqual(["cloud", "local"]);
  });

  test("local provider disables thinking, cloud does not", async () => {
    const [cloud, local] = await resolveProviders(cfgWith(), opts(showing(["completion", "vision"])));
    expect(local!.extraBody).toEqual({ reasoning_effort: "none" });
    expect(cloud!.extraBody).toEqual({});
  });

  test("caches the probe within the TTL, re-probes after it", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        async json() {
          return { capabilities: ["completion"] };
        },
        async text() {
          return "";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const health = newHealth();
    await resolveProviders(cfgWith(), { fetchImpl: counting, health, now: 1000, ttlMs: 60_000 });
    await resolveProviders(cfgWith(), { fetchImpl: counting, health, now: 30_000, ttlMs: 60_000 });
    expect(calls).toBe(1);

    await resolveProviders(cfgWith(), { fetchImpl: counting, health, now: 62_000, ttlMs: 60_000 });
    expect(calls).toBe(2);
  });

  test("a failed cloud request demotes it below local for the TTL", async () => {
    // Offline laptop: without this, every tick burns the cloud timeout first.
    const health = newHealth();
    const up = showing(["completion", "vision"]);

    const first = await resolveProviders(cfgWith(), { fetchImpl: up, health, now: 1000 });
    expect(first.map((p) => p.name)).toEqual(["cloud", "local"]);

    markFailed("cloud", "ECONNREFUSED", { health, now: 1000, ttlMs: 60_000 });

    const second = await resolveProviders(cfgWith(), { fetchImpl: up, health, now: 2000 });
    expect(second.map((p) => p.name)).toEqual(["local", "cloud"]);

    // ...and it recovers once the TTL lapses.
    const third = await resolveProviders(cfgWith(), { fetchImpl: up, health, now: 62_000 });
    expect(third.map((p) => p.name)).toEqual(["cloud", "local"]);
  });

  test("a demoted provider is still attempted last, never dropped", async () => {
    const health = newHealth();
    const up = showing(["completion", "vision"]);
    markFailed("cloud", "boom", { health, now: 1000, ttlMs: 60_000 });
    markFailed("local", "boom", { health, now: 1000, ttlMs: 60_000 });

    const ps = await resolveProviders(cfgWith(), { fetchImpl: up, health, now: 2000 });
    expect(ps.map((p) => p.name)).toEqual(["cloud", "local"]);
  });
});
