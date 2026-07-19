import { describe, expect, test } from "bun:test";
import { analyzeActivity, buildActivityPrompt } from "./analyze.ts";

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
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      app: "Code",
      title: "focus.ts",
      ocrText: "export function isChanged",
      fetchImpl,
    });

    expect(r).toEqual({ summary: "Editing focus.ts", tags: ["coding"], model: "m" });
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
        baseUrl: "https://x/v1",
        apiKey: "k",
        model: "m",
        app: null,
        title: null,
        ocrText: "x",
        retries: 1,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
