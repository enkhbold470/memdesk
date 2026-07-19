import sharp from "sharp";

/**
 * 64-bit average hash (aHash) of an image: downscale to 8x8 grayscale, then set
 * each bit if that pixel is >= the mean. Robust to small visual changes.
 */
export async function averageHash(path: string): Promise<bigint> {
  const { data, info } = await sharp(path)
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels;
  const pixels: number[] = [];
  for (let i = 0; i < data.length; i += ch) pixels.push(data[i]!);

  const avg = pixels.reduce((s, v) => s + v, 0) / pixels.length;
  let hash = 0n;
  for (const p of pixels) {
    hash <<= 1n;
    if (p >= avg) hash |= 1n;
  }
  return hash;
}

/** Number of differing bits between two 64-bit hashes. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * True if `cur` differs enough from `prev` to be worth analyzing.
 * A null `prev` (first frame of the session) always counts as changed.
 */
export function isChanged(prev: bigint | null, cur: bigint, threshold: number): boolean {
  if (prev === null) return true;
  return hamming(prev, cur) > threshold;
}
