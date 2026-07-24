import { describe, expect, test } from "bun:test";
import { buildDigestPrompt, computeAppTime, formatDuration } from "./digest.ts";
import type { Entry } from "./types.ts";

function e(app: string | null, status: Entry["status"], summary?: string): Entry {
  return {
    ts: "2026-07-18T09:00:00-07:00",
    app,
    title: null,
    status,
    screenshot: null,
    analysis: summary ? { summary, tags: [], model: "m", provider: "cloud" } : null,
  };
}

describe("formatDuration", () => {
  test("formats minutes", () => {
    expect(formatDuration(5)).toBe("5m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(200)).toBe("3h20m");
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("computeAppTime", () => {
  test("sums minutes per app, sorted desc", () => {
    const entries = [
      e("Code", "active", "x"),
      e("Code", "idle"),
      e("Code", "active", "y"),
      e("Chrome", "active", "z"),
      e(null, "idle"),
    ];
    const t = computeAppTime(entries, 1);
    expect(t).toEqual({ Code: "3m", Chrome: "1m" });
    expect(Object.keys(t)[0]).toBe("Code"); // most time first
  });

  test("scales by minutesPerEntry", () => {
    expect(computeAppTime([e("Code", "active", "x")], 5)).toEqual({ Code: "5m" });
  });
});

describe("buildDigestPrompt", () => {
  test("includes only active entries with a summary", () => {
    const text = buildDigestPrompt([
      e("Code", "active", "Edited focus.ts"),
      e("Code", "idle"),
      e("Slack", "active"), // no summary
      e(null, "excluded"),
    ]);
    expect(text).toContain("Edited focus.ts");
    expect(text.split("\n")).toHaveLength(1);
  });
});
