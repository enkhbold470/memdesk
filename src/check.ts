import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { analyzeActivity } from "./analyze.ts";
import { hasCloudCreds, loadConfig } from "./config.ts";
import { ensureOcrBinary, ocrImage } from "./ocr.ts";
import { cloudProvider, probeLocal, resolveProviders } from "./provider.ts";
import { analyzeImage } from "./vision.ts";

/**
 * Verify the configured pipeline end-to-end before you rely on it.
 * Reports both providers, then runs a real round trip through the one
 * auto-selection would actually pick.
 */
if (import.meta.main) {
  const cfg = loadConfig();
  const needsVision = cfg.analysisMode === "vision";

  console.log(`[memdesk] mode:     ${cfg.analysisMode}`);
  console.log(`[memdesk] provider: ${cfg.provider}`);

  // --- local ---
  const local = await probeLocal(cfg);
  if (local.ok) {
    console.log(`\n✓ local  — ${cfg.localBaseUrl} — ${local.detail}${local.supportsVision ? " (vision)" : " (text-only)"}`);
  } else {
    console.log(`\n✗ local  — ${local.detail}`);
  }

  // --- cloud ---
  const cloud = cloudProvider(cfg);
  if (cloud) {
    console.log(`✓ cloud  — ${cfg.baseUrl} — ${cfg.model}`);
  } else {
    console.log(`✗ cloud  — missing credentials (OPENAI_BASE_URL / OPENAI_API_KEY / VISION_MODEL)`);
  }

  if (!local.ok && !hasCloudCreds(cfg)) {
    console.error("\n✗ No provider available. Start Ollama, or fill in .env.");
    process.exit(1);
  }

  const providers = await resolveProviders(cfg, { needsVision });
  if (providers.length === 0) {
    console.error(
      `\n✗ No provider can serve ${cfg.analysisMode} mode.` +
        (needsVision ? " Vision mode needs a multimodal model." : ""),
    );
    process.exit(1);
  }
  const chosen = providers[0]!;
  console.log(
    `\n→ would use: ${chosen.name} (${chosen.model})` +
      (providers.length > 1
        ? `, falling back to ${providers[1]!.name} (${providers[1]!.model})`
        : ", no fallback"),
  );

  const testPath = join(tmpdir(), `memdesk-check-${process.pid}.png`);

  /** Mirror runAnalysis: try each provider in order so the check matches reality. */
  async function tryProviders<T>(fn: (p: (typeof providers)[number]) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const p of providers) {
      try {
        return await fn(p);
      } catch (e) {
        lastErr = e;
        console.error(`  ✗ ${p.name} (${p.model}) failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  try {
    if (needsVision) {
      await sharp({
        create: { width: 96, height: 96, channels: 3, background: { r: 30, g: 120, b: 200 } },
      })
        .png()
        .toFile(testPath);
      const r = await tryProviders((p) =>
        analyzeImage({
          imagePath: testPath,
          provider: p,
          app: "memdesk-check",
          title: "connectivity test",
          retries: 0,
        }).then((a) => ({ ...a, used: p })),
      );
      console.log(`\n✓ ${r.used.name} accepted an image and returned an analysis.`);
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
      const r = await tryProviders((p) =>
        analyzeActivity({
          provider: p,
          app: "Code",
          title: "focus.ts",
          ocrText: text,
          retries: 0,
        }).then((a) => ({ ...a, used: p })),
      );
      console.log(`\n✓ ${r.used.name} (${r.model}) returned an analysis.`);
      console.log(`  summary: ${r.summary}`);
      console.log(`  tags:    ${r.tags.join(", ") || "(none)"}`);
      console.log(
        r.used.name === "local"
          ? `\nAll good — nothing left the machine.`
          : `\nAll good — screenshots stay local; only OCR text is sent.`,
      );
    }
  } catch (e) {
    console.error(`\n✗ Check failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  } finally {
    await unlink(testPath).catch(() => {});
  }
}
