import sharp from "sharp";

export class CaptureError extends Error {}

/**
 * Capture the primary display to `outPath` as PNG via macOS `screencapture`.
 * `-x` suppresses the shutter sound; `-m` restricts to the main monitor.
 * Throws CaptureError on a non-zero exit or missing output file.
 */
export async function captureScreen(
  outPath: string,
  opts: { display?: number | "main" } = {},
): Promise<void> {
  const display = opts.display ?? "main";
  const args = ["screencapture", "-x"];
  if (display === "main" || display === 1) {
    args.push("-m");
  } else {
    args.push("-D", String(display));
  }
  args.push(outPath);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = (await new Response(proc.stderr).text()).trim();
    throw new CaptureError(`screencapture exited ${code}${err ? `: ${err}` : ""}`);
  }
  if (!(await Bun.file(outPath).exists())) {
    throw new CaptureError("screencapture produced no output file");
  }
}

/**
 * Best-effort detection of an all-black frame — the signature of a screen that
 * is off, or (sometimes) missing Screen Recording permission. Never throws.
 */
export async function isBlank(path: string): Promise<boolean> {
  try {
    const { channels } = await sharp(path).stats();
    return channels.every((c) => c.mean < 2 && c.max < 8);
  } catch {
    return false;
  }
}

export const PERMISSION_HINT =
  "[memdesk] If screenshots look empty, grant Screen Recording permission:\n" +
  "  System Settings → Privacy & Security → Screen Recording → enable your terminal (or Bun),\n" +
  "  then fully quit and reopen it.";
