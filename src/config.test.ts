import { describe, expect, test } from "bun:test";
import { DEFAULTS, hasVisionCreds, mergeConfig } from "./config.ts";

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
    expect(hasVisionCreds(cfg)).toBe(true);
  });

  test("resolves paths under rootDir", () => {
    const cfg = mergeConfig("/root", {}, {});
    expect(cfg.dataDir).toBe("/root/data");
    expect(cfg.screenshotsDir).toBe("/root/screenshots");
    expect(cfg.webDir).toBe("/root/web");
  });

  test("hasVisionCreds is false when any credential is missing", () => {
    expect(hasVisionCreds(mergeConfig("/root", {}, { OPENAI_BASE_URL: "x" }))).toBe(false);
  });
});
