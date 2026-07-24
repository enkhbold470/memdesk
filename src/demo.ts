import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { loadConfig, type Config } from "./config.ts";
import { computeAppTime } from "./digest.ts";
import { appendEntry, dayKey, hhmmss, localISO, writeSummary } from "./store.ts";
import type { Analysis, DaySummary, Entry } from "./types.ts";

/**
 * Generate a synthetic day of activity for demos and screen recordings.
 *
 * Everything here is fabricated. It exists because the real UI renders your
 * actual screen history — recording that to share it publishes whatever was
 * on screen. This writes to demo/ and never touches data/ or screenshots/.
 * Every entry carries `synthetic: true`, and the UI shows a "demo data" pill.
 */

/** Deterministic PRNG, so the same demo renders identically every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = 1280;
const H = 800;

/** Chrome shared by every mock window: rounded body + traffic lights + title. */
function frame(bg: string, title: string, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0b0d11"/>
  <rect x="0" y="0" width="${W}" height="${H}" rx="0" fill="${bg}"/>
  <rect x="0" y="0" width="${W}" height="36" fill="#000" opacity="0.28"/>
  <circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
  <text x="84" y="23" font-family="SF Pro Text, Helvetica, Arial" font-size="13" fill="#9aa3b2">${esc(title)}</text>
  ${inner}
</svg>`;
}

/** A block of fake syntax-highlighted code. */
function editorScene(r: () => number, file: string): string {
  const palette = ["#6ea8fe", "#c58fff", "#7ee787", "#ffa657", "#9aa3b2", "#e6e9ef"];
  let lines = "";
  for (let i = 0; i < 30; i++) {
    const y = 78 + i * 23;
    const indent = 220 + int(r, 0, 3) * 22;
    let x = indent;
    lines += `<text x="150" y="${y + 4}" font-family="ui-monospace, Menlo" font-size="12" fill="#3d4450">${i + 1}</text>`;
    const tokens = int(r, 2, 6);
    for (let t = 0; t < tokens; t++) {
      const w = int(r, 28, 130);
      if (x + w > W - 90) break;
      lines += `<rect x="${x}" y="${y - 9}" width="${w}" height="11" rx="3" fill="${pick(r, palette)}" opacity="${(0.6 + r() * 0.4).toFixed(2)}"/>`;
      x += w + 12;
    }
  }
  const files = ["provider.ts", "analyze.ts", "store.ts", "digest.ts", "capture.ts", "ocr.ts"];
  let side = "";
  for (let i = 0; i < 6; i++) {
    side += `<text x="26" y="${96 + i * 26}" font-family="ui-monospace, Menlo" font-size="12" fill="${
      files[i] === file ? "#e6e9ef" : "#69707e"
    }">${esc(files[i]!)}</text>`;
  }
  return frame(
    "#1c212b",
    `${file} — memdesk`,
    `<rect x="0" y="36" width="132" height="${H - 36}" fill="#151a23"/>
     <text x="26" y="66" font-family="SF Pro Text, Helvetica" font-size="11" fill="#4c5361">EXPLORER</text>${side}
     <rect x="132" y="36" width="${W - 132}" height="30" fill="#242b38"/>
     <text x="150" y="56" font-family="ui-monospace, Menlo" font-size="12" fill="#c9d1d9">${esc(file)}</text>
     ${lines}`,
  );
}

function terminalScene(r: () => number): string {
  const cmds = [
    "bun test",
    "bun run check",
    "git status --short",
    "ollama ps",
    "bun run digest",
  ];
  let out = "";
  let y = 80;
  while (y < H - 70) {
    out += `<text x="28" y="${y}" font-family="ui-monospace, Menlo" font-size="13" fill="#7ee787">$ ${esc(pick(r, cmds))}</text>`;
    y += 26;
    for (let j = 0; j < int(r, 3, 8) && y < H - 40; j++) {
      out += `<rect x="28" y="${y - 10}" width="${int(r, 160, 900)}" height="10" rx="3" fill="#9aa3b2" opacity="${(0.4 + r() * 0.3).toFixed(2)}"/>`;
      y += 20;
    }
    y += 14;
  }
  return frame("#141a24", "zsh — memdesk", out);
}

function browserScene(r: () => number, site: string): string {
  let blocks = "";
  let y = 150;
  // Fill the frame: thumbnails are object-fit:cover, so a half-empty page
  // crops to a blank rectangle in the timeline.
  for (let i = 0; y < H - 60; i++) {
    if (i % 7 === 6) {
      // occasional figure/code block to break up the text
      const h = int(r, 60, 120);
      blocks += `<rect x="150" y="${y}" width="${int(r, 420, 820)}" height="${h}" rx="8" fill="#6ea8fe" opacity="0.12" stroke="#6ea8fe" stroke-opacity="0.25"/>`;
      y += h + 26;
      continue;
    }
    if (i % 5 === 0) {
      blocks += `<rect x="150" y="${y}" width="${int(r, 220, 380)}" height="18" rx="5" fill="#e6e9ef" opacity="0.6"/>`;
      y += 34;
      continue;
    }
    blocks += `<rect x="150" y="${y}" width="${int(r, 320, 860)}" height="14" rx="4" fill="#9aa3b2" opacity="${(0.4 + r() * 0.32).toFixed(2)}"/>`;
    y += i % 3 === 2 ? 40 : 26;
  }
  return frame(
    "#1a1f29",
    site,
    `<rect x="0" y="36" width="${W}" height="40" fill="#232a37"/>
     <rect x="150" y="47" width="620" height="20" rx="10" fill="#12161d"/>
     <text x="164" y="62" font-family="SF Pro Text, Helvetica" font-size="12" fill="#69707e">${esc(site)}</text>
     <rect x="150" y="102" width="${int(r, 300, 520)}" height="22" rx="5" fill="#e6e9ef" opacity="0.75"/>
     ${blocks}`,
  );
}

function chatScene(r: () => number): string {
  let rows = "";
  let y = 90;
  while (y < H - 70) {
    const mine = r() > 0.55;
    const w = int(r, 180, 560);
    rows += `<circle cx="196" cy="${y + 6}" r="11" fill="${mine ? "#6ea8fe" : "#b58b4c"}" opacity="0.8"/>
             <rect x="218" y="${y - 4}" width="${w}" height="12" rx="4" fill="#9aa3b2" opacity="0.5"/>`;
    if (r() > 0.5) {
      rows += `<rect x="218" y="${y + 14}" width="${int(r, 120, 420)}" height="12" rx="4" fill="#9aa3b2" opacity="0.35"/>`;
      y += 22;
    }
    y += 40;
  }
  let chans = "";
  for (let i = 0; i < 7; i++) {
    chans += `<text x="26" y="${100 + i * 28}" font-family="SF Pro Text, Helvetica" font-size="12" fill="#69707e"># ${esc(
      pick(r, ["general", "eng", "design", "standup", "releases", "random", "alerts"]),
    )}</text>`;
  }
  return frame(
    "#221b2b",
    "Slack — team",
    `<rect x="0" y="36" width="170" height="${H - 36}" fill="#191320"/>${chans}${rows}`,
  );
}

function designScene(r: () => number): string {
  let shapes = "";
  for (let i = 0; i < 9; i++) {
    const x = int(r, 240, 900);
    const y = int(r, 120, 620);
    const w = int(r, 90, 260);
    const h = int(r, 60, 160);
    shapes += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${pick(r, [
      "#6ea8fe",
      "#b58b4c",
      "#7ee787",
      "#c58fff",
    ])}" opacity="${(0.35 + r() * 0.4).toFixed(2)}" stroke="#6ea8fe" stroke-opacity="0.4"/>`;
  }
  return frame(
    "#171d26",
    "Figma — memdesk UI",
    `<rect x="0" y="36" width="180" height="${H - 36}" fill="#11151c"/>
     <rect x="${W - 200}" y="36" width="200" height="${H - 36}" fill="#11151c"/>${shapes}`,
  );
}

interface SceneItem {
  title: string;
  summary: string;
  tags: string[];
}

interface Scene {
  app: string;
  /** title/summary/tags travel together so a row is always self-consistent. */
  items: SceneItem[];
  render: (r: () => number, title: string) => string;
}

const SCENES: Scene[] = [
  {
    app: "Code",
    items: [
      { title: "provider.ts", summary: "Writing the provider fallback logic that picks between the cloud and local models.", tags: ["coding", "typescript"] },
      { title: "analyze.ts", summary: "Refactoring the analysis call sites to take a single provider object.", tags: ["refactor", "coding"] },
      { title: "digest.ts", summary: "Adding unit tests for the health-check cache and its expiry.", tags: ["testing", "typescript"] },
      { title: "store.ts", summary: "Fixing a bug where an empty model reply was recorded as a successful analysis.", tags: ["debugging"] },
      { title: "capture.ts", summary: "Reading through the screenshot capture path looking for the blank-frame check.", tags: ["reading", "coding"] },
      { title: "ocr.ts", summary: "Tracing how OCR text gets handed to the summariser.", tags: ["reading", "coding"] },
    ],
    render: (r, title) => editorScene(r, title),
  },
  {
    app: "Terminal",
    items: [
      { title: "bun test", summary: "Running the test suite and watching for failures.", tags: ["testing", "terminal"] },
      { title: "git", summary: "Checking git status before committing the provider changes.", tags: ["git"] },
      { title: "zsh", summary: "Timing how long a local model call takes compared to the cloud one.", tags: ["benchmarking", "terminal"] },
      { title: "zsh", summary: "Tailing the capture loop's output to confirm frames are being skipped.", tags: ["debugging"] },
      { title: "ollama", summary: "Checking which models are currently loaded in memory.", tags: ["terminal"] },
    ],
    render: (r) => terminalScene(r),
  },
  {
    app: "Safari",
    items: [
      { title: "Ollama docs", summary: "Reading the Ollama API documentation about model capabilities.", tags: ["docs", "research"] },
      { title: "OpenAI API reference", summary: "Looking up how the chat completions endpoint handles reasoning parameters.", tags: ["docs", "api"] },
      { title: "Hacker News", summary: "Skimming Hacker News between tasks.", tags: ["browsing"] },
      { title: "Ollama docs", summary: "Comparing quantisation options for the local model.", tags: ["research"] },
      { title: "OpenAI API reference", summary: "Reading about how thinking models budget their output tokens.", tags: ["docs", "research"] },
    ],
    render: (r, title) => browserScene(r, title),
  },
  {
    app: "Slack",
    items: [
      { title: "#eng", summary: "Catching up on the engineering channel and replying to a review request.", tags: ["communication"] },
      { title: "#standup", summary: "Posting a standup update about the hybrid provider work.", tags: ["standup", "communication"] },
      { title: "#releases", summary: "Reading a thread about the upcoming release cut.", tags: ["release"] },
      { title: "#eng", summary: "Answering a question about how the fallback picks a model.", tags: ["communication"] },
      { title: "#eng", summary: "Skimming unread messages after a focus block.", tags: ["communication"] },
    ],
    render: (r) => chatScene(r),
  },
  {
    app: "Figma",
    items: [
      { title: "memdesk UI", summary: "Adjusting the spacing and colours of the timeline rows.", tags: ["design", "ui"] },
      { title: "timeline v2", summary: "Sketching a compact variant of the entry row.", tags: ["design"] },
      { title: "timeline v2", summary: "Comparing two layouts for the daily digest panel.", tags: ["design", "layout"] },
    ],
    render: (r) => designScene(r),
  },
];

/** A believable working day: focused blocks, breaks, one locked app. */
interface Block {
  scene: Scene | null;
  /** minutes */
  len: number;
  kind: "active" | "idle" | "excluded";
  app?: string;
}

function buildBlocks(r: () => number): Block[] {
  const blocks: Block[] = [];
  const push = (b: Block) => blocks.push(b);

  push({ scene: SCENES[1]!, len: 6, kind: "active" }); // terminal: start the day
  push({ scene: SCENES[3]!, len: 9, kind: "active" }); // slack
  push({ scene: SCENES[0]!, len: 48, kind: "active" }); // deep work
  push({ scene: null, len: 14, kind: "idle" });
  push({ scene: SCENES[0]!, len: 37, kind: "active" });
  push({ scene: SCENES[2]!, len: 12, kind: "active" }); // docs
  push({ scene: SCENES[0]!, len: 26, kind: "active" });
  push({ scene: null, len: 41, kind: "idle" }); // lunch
  push({ scene: SCENES[1]!, len: 8, kind: "active" });
  push({ scene: null, len: 4, kind: "excluded", app: "1Password" });
  push({ scene: SCENES[0]!, len: 52, kind: "active" });
  push({ scene: SCENES[4]!, len: 18, kind: "active" }); // figma
  push({ scene: null, len: 11, kind: "idle" });
  push({ scene: SCENES[0]!, len: 44, kind: "active" });
  push({ scene: SCENES[1]!, len: 7, kind: "active" });
  push({ scene: SCENES[3]!, len: 6, kind: "active" });
  push({ scene: SCENES[2]!, len: 9, kind: "active" });
  push({ scene: SCENES[0]!, len: 31, kind: "active" });
  push({ scene: SCENES[1]!, len: 5, kind: "active" });
  // Jitter the block lengths a little so no two demo days look identical.
  return blocks.map((b) => ({ ...b, len: Math.max(2, b.len + int(r, -3, 3)) }));
}

const DIGESTS: Array<{ narrative: string; shipped: string[] }> = [
  {
    narrative:
      "A build-heavy day. Most of it went into the provider layer — first the fallback ordering, then the tests around it — with a short detour into the Ollama docs to confirm how model capabilities are reported. The afternoon was mostly uninterrupted.",
    shipped: [
      "Provider abstraction with cloud-first selection and local fallback",
      "Health-check caching so the picker doesn't probe on every call",
      "Unit tests covering provider resolution and expiry",
    ],
  },
  {
    narrative:
      "Split between fixing the empty-reply bug and cleaning up the timeline UI. The bug took the morning; the afternoon was design work in Figma and then porting those spacing changes into the stylesheet.",
    shipped: [
      "Fix: an empty model reply no longer counts as a successful analysis",
      "Timeline row spacing and colour pass",
      "Provenance badge showing which backend answered each entry",
    ],
  },
];

async function renderPool(r: () => number): Promise<Map<string, Buffer[]>> {
  const pool = new Map<string, Buffer[]>();
  for (const scene of SCENES) {
    const bufs: Buffer[] = [];
    // A handful of variants per app — you revisit the same window all day,
    // so some repetition is what real usage actually looks like.
    for (const { title } of scene.items) {
      for (let v = 0; v < 2; v++) {
        const svg = scene.render(r, title);
        bufs.push(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
      }
    }
    pool.set(scene.app, bufs);
  }
  return pool;
}

async function generateDay(cfg: Config, date: Date, seed: number, digest: { narrative: string; shipped: string[] }) {
  const r = rng(seed);
  const day = dayKey(date);
  const pool = await renderPool(rng(seed + 7));
  const shotDir = join(cfg.screenshotsDir, day);
  await mkdir(shotDir, { recursive: true });

  const entries: Entry[] = [];
  const cursor = new Date(date);
  cursor.setHours(9, 12, 0, 0);

  for (const block of buildBlocks(r)) {
    // Rotate through a scene's variants so consecutive rows don't repeat a
    // summary verbatim.
    let variant = int(r, 0, 99);
    for (let m = 0; m < block.len; m++) {
      const ts = localISO(cursor);
      // Real change detection marks an unchanged frame idle, so a long block
      // is never a solid wall of analysed minutes.
      const changed = m === 0 || r() < 0.5;
      if (block.kind === "active" && block.scene && changed) {
        const scene = block.scene;
        const item = scene.items[variant++ % scene.items.length]!;
        const title = item.title;
        const bufs = pool.get(scene.app)!;
        const file = `${hhmmss(cursor)}.png`;
        await writeFile(join(shotDir, file), pick(r, bufs));
        const analysis: Analysis = {
          summary: item.summary,
          tags: item.tags,
          model: r() > 0.25 ? "gemma-4-31B-it" : "gemma4:e2b",
          provider: "cloud",
        };
        if (analysis.model.startsWith("gemma4:")) analysis.provider = "local";
        entries.push({
          ts,
          app: scene.app,
          title,
          status: "active",
          // Same relative form real entries use — the server resolves it
          // against cfg.screenshotsDir, which already points at demo/.
          screenshot: `screenshots/${day}/${file}`,
          analysis,
          synthetic: true,
        });
      } else {
        // An unchanged frame inside an active block is idle, but the app is
        // still known — that's what the real capture loop records.
        const idleInBlock = block.kind === "active";
        entries.push({
          ts,
          app: idleInBlock ? (block.scene?.app ?? null) : block.kind === "excluded" ? (block.app ?? null) : null,
          title: null,
          status: idleInBlock ? "idle" : block.kind,
          screenshot: null,
          analysis: null,
          synthetic: true,
        });
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
  }

  for (const e of entries) await appendEntry(cfg, e);

  const summary: DaySummary = {
    date: day,
    narrative: digest.narrative,
    shipped: digest.shipped,
    appTime: computeAppTime(entries, 1),
    generatedAt: localISO(date),
    synthetic: true,
  };
  await writeSummary(cfg, summary);

  const active = entries.filter((e) => e.status === "active").length;
  console.log(`  ${day}: ${entries.length} entries, ${active} analyzed`);
  return entries.length;
}

if (import.meta.main) {
  const cfg = loadConfig();
  if (!cfg.demo) {
    console.error(
      "✗ Refusing to run: MEMDESK_DEMO=1 is not set, so this would write into your real data/ and screenshots/.\n" +
        "  Use `bun run demo` instead.",
    );
    process.exit(1);
  }

  console.log("[memdesk] generating synthetic demo data (nothing here is a real recording)\n");
  // Start clean so reruns don't stack days on top of each other.
  await rm(join(cfg.rootDir, "demo"), { recursive: true, force: true });

  const today = new Date();
  for (let i = 0; i < DIGESTS.length; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    await generateDay(cfg, d, 1000 + i * 31, DIGESTS[i]!);
  }

  console.log(`\n✓ Wrote demo/ — every entry flagged synthetic: true`);
  console.log(`  Serving it now on http://localhost:${cfg.port} (ctrl-c to stop).`);
  console.log(`  Re-serve without regenerating:  bun run demo:serve`);
}
