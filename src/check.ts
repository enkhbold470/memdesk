import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { analyzeActivity } from "./analyze.ts";
import { hasVisionCreds, loadConfig } from "./config.ts";
import { ensureOcrBinary, ocrImage } from "./ocr.ts";
import { analyzeImage } from "./vision.ts";

/**
 * Verify the configured pipeline end-to-end before you rely on it.
 * - ocr mode:    compile+run the OCR helper on a text image, then summarize via the text endpoint.
 * - vision mode: send an image to the endpoint.
 */
if (import.meta.main) {
  const cfg = loadConfig();
  console.log(`[memdesk] endpoint: ${cfg.baseUrl || "(unset)"}`);
  console.log(`[memdesk] model:    ${cfg.model || "(unset)"}`);
  console.log(`[memdesk] mode:     ${cfg.analysisMode}`);

  if (!hasVisionCreds(cfg)) {
    console.error("\n✗ Missing credentials. Set OPENAI_BASE_URL, OPENAI_API_KEY, VISION_MODEL in .env.");
    process.exit(1);
  }

  const testPath = join(tmpdir(), `memdesk-check-${process.pid}.png`);

  try {
    if (cfg.analysisMode === "vision") {
      await sharp({
        create: { width: 96, height: 96, channels: 3, background: { r: 30, g: 120, b: 200 } },
      })
        .png()
        .toFile(testPath);
      const r = await analyzeImage({
        imagePath: testPath,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        app: "memdesk-check",
        title: "connectivity test",
        retries: 0,
      });
      console.log(`\n✓ Endpoint accepted an image and returned an analysis.`);
      console.log(`  summary: ${r.summary}`);
      console.log(`  tags:    ${r.tags.join(", ") || "(none)"}`);
    } else {
      // 1. OCR helper
      const bin = await ensureOcrBinary(cfg);
      if (!bin) {
        console.error("\n✗ OCR helper unavailable — install Xcode Command Line Tools (`xcode-select --install`) so `swiftc` exists.");
        process.exit(2);
      }
      console.log(`\n✓ OCR helper ready (${bin}).`);

      // 2. OCR a generated text image
      const phrase = "memdesk activity log 42";
      const svg = `<svg width="640" height="140"><rect width="640" height="140" fill="white"/><text x="20" y="90" font-size="40" font-family="Helvetica" fill="black">${phrase}</text></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(testPath);
      const text = await ocrImage(bin, testPath);
      if (!text.toLowerCase().includes("memdesk")) {
        console.error(`✗ OCR did not read the test image as expected. Got: ${JSON.stringify(text)}`);
        process.exit(2);
      }
      console.log(`✓ OCR read the test image: ${JSON.stringify(text)}`);

      // 3. Text summarization
      const r = await analyzeActivity({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        app: "Code",
        title: "focus.ts",
        ocrText: text,
        retries: 0,
      });
      console.log(`\n✓ Text endpoint returned an analysis.`);
      console.log(`  summary: ${r.summary}`);
      console.log(`  tags:    ${r.tags.join(", ") || "(none)"}`);
      console.log(`\nAll good — screenshots stay local; only OCR text is sent.`);
    }
  } catch (e) {
    console.error(`\n✗ Check failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  } finally {
    await unlink(testPath).catch(() => {});
  }
}
