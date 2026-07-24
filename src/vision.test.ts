import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Provider } from "./provider.ts";
import { analyzeImage, parseVisionContent } from "./vision.ts";

const cloud: Provider = {
  name: "cloud",
  baseUrl: "https://x/v1",
  apiKey: "k",
  model: "m",
  supportsVision: true,
  extraBody: {},
};

let img: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "memdesk-vision-"));
  img = join(dir, "t.png");
  await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toFile(img);
});
afterAll(async () => {
  await rm(img, { force: true }).catch(() => {});
});

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { choices: [{ message: { content } }] };
    },
    async text() {
      return content;
    },
  } as unknown as Response;
}

describe("parseVisionContent", () => {
  test("plain JSON", () => {
    expect(parseVisionContent('{"summary":"Editing code","tags":["Coding","TS"]}')).toEqual({
      summary: "Editing code",
      tags: ["coding", "ts"],
    });
  });
  test("fenced JSON with prose", () => {
    const c = 'Here you go:\n```json\n{"summary":"Reading a PR","tags":["review"]}\n```';
    expect(parseVisionContent(c)).toEqual({ summary: "Reading a PR", tags: ["review"] });
  });
  test("caps tags at 3", () => {
    expect(parseVisionContent('{"summary":"x","tags":["a","b","c","d","e"]}').tags).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  test("throws on non-JSON", () => {
    expect(() => parseVisionContent("no json here")).toThrow();
  });
});

describe("analyzeImage", () => {
  test("parses a successful response", async () => {
    const fetchImpl = (async () =>
      okResponse('{"summary":"Editing focus.ts","tags":["coding"]}')) as unknown as typeof fetch;
    const r = await analyzeImage({
      imagePath: img,
      provider: cloud,
      app: "Code",
      title: "focus.ts",
      fetchImpl,
    });
    expect(r).toEqual({
      summary: "Editing focus.ts",
      tags: ["coding"],
      model: "m",
      provider: "cloud",
    });
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
      analyzeImage({
        imagePath: img,
        provider: cloud,
        app: null,
        title: null,
        retries: 1,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2); // initial + 1 retry
  });

  test("succeeds on the retry after one failure", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, async text() {
        return "later";
      } } as unknown as Response;
      return okResponse('{"summary":"ok now","tags":[]}');
    }) as unknown as typeof fetch;

    const r = await analyzeImage({
      imagePath: img,
      provider: cloud,
      app: null,
      title: null,
      retries: 1,
      fetchImpl,
    });
    expect(r.summary).toBe("ok now");
    expect(calls).toBe(2);
  });
});
