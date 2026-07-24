import { describe, expect, test } from "bun:test";
import { analyzeActivity, buildActivityPrompt } from "./analyze.ts";
import type { Provider } from "./provider.ts";

const cloud: Provider = {
  name: "cloud",
  baseUrl: "https://x/v1",
  apiKey: "k",
  model: "m",
  supportsVision: true,
  extraBody: {},
};

describe("buildActivityPrompt", () => {
  test("includes app, title, and OCR text", () => {
    const p = buildActivityPrompt("Code", "focus.ts", "export function isChanged() {}");
    expect(p).toContain("App: Code");
    expect(p).toContain("Window title: focus.ts");
    expect(p).toContain("isChanged");
  });
  test("handles nulls and empty OCR", () => {
    const p = buildActivityPrompt(null, null, "");
    expect(p).toContain("App: unknown");
    expect(p).toContain("(none detected)");
  });
});

describe("analyzeActivity", () => {
  test("sends STRING content (endpoint rejects arrays) and parses the reply", async () => {
    let sentBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: '{"summary":"Editing focus.ts","tags":["coding"]}' } }] };
        },
        async text() {
          return "";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await analyzeActivity({
      provider: cloud,
      app: "Code",
      title: "focus.ts",
      ocrText: "export function isChanged",
      fetchImpl,
    });

    expect(r).toEqual({
      summary: "Editing focus.ts",
      tags: ["coding"],
      model: "m",
      provider: "cloud",
    });
    // The whole point of OCR mode: content is a plain string, not a parts array.
    expect(typeof sentBody.messages[1].content).toBe("string");
    expect(sentBody.messages[1].content).toContain("export function isChanged");
  });

  test("retries once then throws on persistent failure", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 500, async text() {
        return "boom";
      } } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      analyzeActivity({
        provider: cloud,
        app: null,
        title: null,
        ocrText: "x",
        retries: 1,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });

  test("merges provider.extraBody into the request (local disables thinking)", async () => {
    // Regression guard: without reasoning_effort, gemma4 spends the whole
    // max_tokens budget on reasoning tokens and returns empty content.
    let sentBody: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: '{"summary":"s","tags":[]}' } }] };
        },
        async text() {
          return "";
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const local: Provider = {
      name: "local",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      model: "gemma4:e2b",
      supportsVision: true,
      extraBody: { reasoning_effort: "none" },
    };
    const r = await analyzeActivity({ provider: local, app: null, title: null, ocrText: "x", fetchImpl });

    expect(sentBody.reasoning_effort).toBe("none");
    expect(r.provider).toBe("local");
    expect(r.model).toBe("gemma4:e2b");
  });
});
