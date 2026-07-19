# memdesk

A local, all-day **screenshot journal + AI activity log** for macOS. Every minute it captures your
primary screen; when the screen meaningfully changed, it reads the on-screen text with the built-in
macOS OCR engine and asks a text LLM what you were doing. The result is a timestamped JSON history
you can scroll through in a small web UI, plus an end-of-day "what I shipped" digest.

Built with Bun + TypeScript. **In the default `ocr` mode the screenshots never leave your machine —
only the extracted text is sent to your configured endpoint.**

## How it works

```
every 60s → screencapture (primary display) → frontmost app + window title
          → perceptual-hash the frame, compare to the last one
          → UNCHANGED → log an "idle" minute, drop the duplicate image
          → CHANGED   → OCR the image locally (macOS Vision)
                      → send app + title + OCR text to your endpoint → store {summary, tags}
```

- **Change-based** — idle stretches cost no API calls (~300–600/day instead of 1440).
- **Retention** — history JSON is kept forever; screenshot PNGs auto-purge after 14 days.
- **Privacy** — in `ocr` mode only text leaves your machine; `excludeApps` skips capture entirely
  for sensitive apps; `pause`/`resume` suspends capture; `.env`, `screenshots/`, and `data/` are
  gitignored.

> **Why OCR instead of sending the image?** memdesk is built for OpenAI-compatible endpoints. Many
> gateways (including vLLM behind a proxy) only accept text `content`, not the multimodal image
> array. OCR mode works with any text endpoint and keeps images local. If you *do* have a
> multimodal endpoint, set `"analysisMode": "vision"` to send the image instead.

## Setup

```bash
bun install
cp .env.example .env          # then fill in your endpoint + key
bun run check                 # compiles the OCR helper + verifies OCR → text endpoint
```

`ocr` mode compiles a tiny macOS Vision helper with `swiftc`, so you need the Xcode Command Line
Tools (`xcode-select --install`). It builds automatically on first run.

`.env`:

```
OPENAI_BASE_URL=https://app-eaae8a882a.arkor.app/v1
OPENAI_API_KEY=...
VISION_MODEL=gemma-4-31B-it
```

macOS will ask for **Screen Recording** permission the first time (System Settings → Privacy &
Security → Screen Recording → enable your terminal or `bun`, then restart it).

## Use

```bash
bun start          # capture loop (Ctrl-C to stop)
bun run server     # timeline UI at http://localhost:4319
bun run digest     # generate today's "what I shipped" summary (add a date arg for another day)
bun run pause      # suspend capture
bun run resume     # resume capture
bun run reanalyze  # retry vision on entries whose analysis failed (PNG must still exist)
bun test           # unit + integration tests
```

Run it all day in the background:

```bash
bun run install-daemon     # launchd agent, starts at login
bun run uninstall-daemon
```

## Config

Optional `config.json` in the project root (see `config.example.json`):

| Key | Default | Meaning |
|---|---|---|
| `intervalSec` | `60` | Seconds between captures |
| `retentionDays` | `14` | Delete screenshot PNGs older than this |
| `changeThreshold` | `5` | Max hash distance still treated as "same frame" (higher = fewer calls) |
| `display` | `"main"` | `"main"` for the primary monitor, or a numeric display id |
| `analysisMode` | `"ocr"` | `"ocr"` (OCR locally, send text) or `"vision"` (send the image) |
| `port` | `4319` | Web UI port |
| `excludeApps` | `["1Password", "Messages"]` | Capture skipped when one of these is frontmost |

## Data layout

```
data/2026-07-18.jsonl          # one JSON entry per minute
data/2026-07-18.summary.json   # daily digest (narrative, shipped[], appTime{})
screenshots/2026-07-18/HHMMSS.png
```

## Not included (v1)

Multi-monitor / active-window-only capture, OCR, cross-day search, non-macOS support, cloud sync.
