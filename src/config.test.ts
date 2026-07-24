import { describe, expect, test } from "bun:test";
import { DEFAULTS, hasCloudCreds, mergeConfig } from "./config.ts";

describe("mergeConfig", () => {
  test("uses defaults when file and env are empty", () => {
    const cfg = mergeConfig("/root", {}, {});
    expect(cfg.intervalSec).toBe(DEFAULTS.intervalSec);
    expect(cfg.retentionDays).toBe(DEFAULTS.retentionDays);
    expect(cfg.changeThreshold).toBe(DEFAULTS.changeThreshold);
    expect(cfg.excludeApps).toEqual(DEFAULTS.excludeApps);
    expect(cfg.model).toBe("gemma-4-31B-it");
  });

  test("file overrides win over defaults", () => {
    const cfg = mergeConfig(
      "/root",
      { intervalSec: 30, retentionDays: 7, excludeApps: ["Signal"] },
      {},
    );
    expect(cfg.intervalSec).toBe(30);
    expect(cfg.retentionDays).toBe(7);
    expect(cfg.excludeApps).toEqual(["Signal"]);
  });

  test("env supplies endpoint credentials", () => {
    const cfg = mergeConfig("/root", {}, {
      OPENAI_BASE_URL: "https://x/v1",
      OPENAI_API_KEY: "k",
      VISION_MODEL: "m",
    });
    expect(cfg.baseUrl).toBe("https://x/v1");
    expect(cfg.apiKey).toBe("k");
    expect(cfg.model).toBe("m");
    expect(hasCloudCreds(cfg)).toBe(true);
  });

  test("resolves paths under rootDir", () => {
    const cfg = mergeConfig("/root", {}, {});
    expect(cfg.dataDir).toBe("/root/data");
    expect(cfg.screenshotsDir).toBe("/root/screenshots");
    expect(cfg.webDir).toBe("/root/web");
  });

  test("hasCloudCreds is false when any credential is missing", () => {
    expect(hasCloudCreds(mergeConfig("/root", {}, { OPENAI_BASE_URL: "x" }))).toBe(false);
  });

  test("provider defaults to auto and can be pinned via config.json", () => {
    expect(mergeConfig("/root", {}, {}).provider).toBe("auto");
    expect(mergeConfig("/root", { provider: "local" }, {}).provider).toBe("local");
  });

  test("local endpoint defaults, overridable by env", () => {
    const d = mergeConfig("/root", {}, {});
    expect(d.localBaseUrl).toBe("http://localhost:11434/v1");
    expect(d.localModel).toBe("gemma4:e2b");
    const o = mergeConfig("/root", {}, { OLLAMA_BASE_URL: "http://box:1/v1", OLLAMA_MODEL: "x" });
    expect(o.localBaseUrl).toBe("http://box:1/v1");
    expect(o.localModel).toBe("x");
  });
});
