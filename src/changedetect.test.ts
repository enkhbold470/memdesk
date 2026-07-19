import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { averageHash, hamming, isChanged } from "./changedetect.ts";

let dir: string;

/** Write a 16x16 grayscale PNG whose pixel value comes from fn(x,y). */
async function makeImg(name: string, fn: (x: number, y: number) => number): Promise<string> {
  const w = 16;
  const h = 16;
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) buf[y * w + x] = Math.max(0, Math.min(255, fn(x, y)));
  }
  const path = join(dir, name);
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path);
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "memdesk-cd-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("hamming", () => {
  test("counts differing bits", () => {
    expect(hamming(0b1010n, 0b0011n)).toBe(2);
    expect(hamming(0n, 0n)).toBe(0);
    expect(hamming(0xffffffffffffffffn, 0n)).toBe(64);
  });
});

describe("isChanged", () => {
  test("null prev is always a change", () => {
    expect(isChanged(null, 123n, 5)).toBe(true);
  });
  test("within threshold is not a change", () => {
    expect(isChanged(0b1111n, 0b1110n, 5)).toBe(false); // 1 bit
  });
  test("beyond threshold is a change", () => {
    expect(isChanged(0xffffn, 0x0000n, 5)).toBe(true); // 16 bits
  });
});

describe("averageHash", () => {
  test("identical images hash equal → not changed", async () => {
    const grad = (x: number) => x * 16;
    const a = await makeImg("a.png", grad);
    const b = await makeImg("b.png", grad);
    const ha = await averageHash(a);
    const hb = await averageHash(b);
    expect(hamming(ha, hb)).toBe(0);
    expect(isChanged(ha, hb, 5)).toBe(false);
  });

  test("a left/right split vs its inverse differ a lot → changed", async () => {
    const left = await makeImg("left.png", (x) => (x < 8 ? 20 : 235));
    const right = await makeImg("right.png", (x) => (x < 8 ? 235 : 20));
    const hl = await averageHash(left);
    const hr = await averageHash(right);
    expect(hamming(hl, hr)).toBeGreaterThan(5);
    expect(isChanged(hl, hr, 5)).toBe(true);
  });
});
