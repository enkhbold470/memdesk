# memdesk — local screenshot journal + AI activity log

**Date:** 2026-07-18
**Status:** Implemented (with amendment — see below)
**Author:** Inky + Claude (brainstorming)

## Amendment (2026-07-18, during implementation)

Verification against the chosen endpoint (`https://app-eaae8a882a.arkor.app/v1`, vLLM behind an
arkor.app gateway) found it **rejects OpenAI multimodal content** — its gateway requires
`messages[].content` to be a string and returns `expected string, received array` for the image
format. Text chat works fine. So "send each screenshot to the model" is impossible through this URL.

**Resolution (chosen by Inky): local OCR + text summarization.** Each changed frame is OCR'd on-device
with the macOS Vision framework (a tiny `swiftc`-compiled helper, `ocr/ocr.swift`), and the extracted
text + app/title is sent to the text endpoint. **Screenshots never leave the machine** — only text
does. A config key `analysisMode: "ocr" | "vision"` (default `"ocr"`) preserves the original image
pipeline for anyone with a multimodal endpoint. Everything else below is unchanged.

## Context

Inky wants a personal, always-on record of what he actually did on his computer each day — a
minute-by-minute visual history plus an end-of-day "what I shipped" summary — so a day's work is
reconstructable instead of forgotten.

`memdesk/` (`/Users/inky/Desktop/neurofocus-brain/memdesk`) is a fresh, standalone project sitting
beside the NeuroFocus repos but unrelated to the EEG work. It is greenfield, macOS (Darwin), with no
existing code to integrate with.

**Intended outcome:** Run `bun start`, and every minute the primary screen is captured; when the
screen meaningfully changed, the frame is described by Inky's OpenAI-compatible vision endpoint and
appended to a timestamped JSON history. A small local web UI scrolls through the day, and a daily
digest narrates what got shipped. Once trusted, it runs all day as a background launchd agent.

## Locked decisions

| Decision | Choice |
|---|---|
| Analysis engine | Inky's **OpenAI-compatible** vision endpoint (not Claude) |
| Model / URL | `gemma-4-31B-it` @ `https://app-eaae8a882a.arkor.app/v1` (both env-configurable) |
| Cadence | **Change-based** — capture every minute, call the model only when the frame changed |
| Capture scope | **Primary display** (`screencapture -x -D 1`) |
| Run model | **Both** — foreground CLI now (`bun start`) + installable launchd agent |
| Retention | **Keep JSON forever, auto-purge PNGs after 14 days** (configurable) |
| Web UI | **Vanilla HTML/CSS/JS served by `Bun.serve`** (no framework, no build) |
| Stack | **Bun + TypeScript**, macOS |
| OCR | **Dropped** (YAGNI) — vision model reads the screen; app/title kept as cheap hint |

## Architecture

Per-minute loop (`src/index.ts`):

```
every 60s:
  1. context.ts     → frontmost app name + window title (osascript)
                      [if app ∈ excludeApps → skip capture + analysis entirely for this minute]
  2. capture.ts     → screencapture -x -D 1 → screenshots/YYYY-MM-DD/HHMMSS.png
  3. changedetect.ts→ perceptual (average) hash via sharp; Hamming-compare to last hash
  4a. UNCHANGED     → write status:"idle" entry, delete the just-taken duplicate PNG
  4b. CHANGED       → vision.ts: base64 PNG → POST /chat/completions (image + app/title hint)
                      → write status:"active" entry with {summary, tags}
  5. store.ts       → append one JSONL line to data/YYYY-MM-DD.jsonl
  (hourly) store.ts → purge PNGs older than retentionDays
```

The design deliberately keeps each unit single-purpose so it can be understood and tested in
isolation: capture knows nothing about vision, changedetect is a pure function over two hashes, the
store is the only writer of history, and the loop wires them together.

## Components / files

- `package.json` — Bun scripts: `start`, `server`, `digest`, `check`, `reanalyze`, `pause`,
  `resume`, `install-daemon`, `uninstall-daemon`, `test`. Runtime dep: `sharp`.
- `src/config.ts` — loads `.env` + optional `config.json`. Fields: `intervalSec` (60),
  `retentionDays` (14), `changeThreshold` (max Hamming distance treated as "same", default 5),
  `display` (1), `excludeApps[]` (e.g. `["1Password", "Messages"]`), `port` (4319), and endpoint
  settings `baseUrl` / `apiKey` / `model` from env.
- `src/capture.ts` — wraps `screencapture -x -D <n>`; returns the PNG path; detects a failed or
  all-black capture and surfaces a clear Screen-Recording-permission message.
- `src/context.ts` — frontmost app name + window title via `osascript` / System Events; degrades to
  `null` when unavailable (e.g. Accessibility not granted).
- `src/changedetect.ts` — `sharp` resize → grayscale → 8×8 → 64-bit average hash; `hamming(a, b)`;
  `isChanged(prevHash, hash, threshold)`. Pure and unit-testable.
- `src/vision.ts` — OpenAI-compatible client over `fetch`. Builds a `chat/completions` request with
  an `image_url` data URL plus the app/title hint and a concise system prompt ("describe in one
  sentence what the user is doing, plus 1–3 lowercase tags; reply as JSON"). Parses the JSON reply;
  1 retry on failure; request timeout. Returns `{summary, tags, model}` or `null` on failure.
- `src/store.ts` — the only writer of history: append a JSONL line, read a day, write/read the daily
  summary, and `purgeOldScreenshots(retentionDays)` (deletes PNG files only, never JSON).
- `src/index.ts` — the loop. Clean SIGINT shutdown. Honors a `PAUSED` flag file so `pause`/`resume`
  can suspend capture without killing the process.
- `src/digest.ts` — `bun run digest [date]`: read the day's entries → one text-only model call →
  `{narrative, shipped[], appTime{}}` → `data/YYYY-MM-DD.summary.json`. `appTime` is computed
  locally from entry timestamps, not by the model.
- `src/reanalyze.ts` — `bun run reanalyze [date]`: re-run vision on entries with `analysis:null`
  whose PNG still exists on disk.
- `src/check.ts` — `bun run check`: send one tiny test image to the endpoint; report whether the
  model accepts image input. If it rejects images, warn and note the app/title-only fallback.
- `src/server.ts` — `Bun.serve`: `/` → `web/index.html`; `GET /api/days` (list of dates);
  `GET /api/day/:date` (entries as JSON + the day's summary if present); `GET /screenshots/*`
  (static PNGs). Localhost only.
- `web/index.html` + `web/app.js` + `web/style.css` — a scrollable timeline grouped by hour. Each
  entry shows time · thumbnail · app/title · AI summary · tags. A day header shows the digest.
  Includes a date switcher; consecutive idle minutes are collapsed into a single span.
- `daemon/com.memdesk.agent.plist` (template) + `daemon/install.sh` / `daemon/uninstall.sh` — a
  launchd agent that runs `bun start` at login; the scripts wire up / tear down
  `~/Library/LaunchAgents`.
- `.env.example` (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `VISION_MODEL`), `.gitignore`
  (`.env`, `screenshots/`, `data/`, `node_modules/`, `PAUSED`), `README.md`.

## Data model

Per-minute entry — one JSON object per line in `data/YYYY-MM-DD.jsonl`:

```json
{"ts":"2026-07-18T12:03:00-07:00","app":"Code","title":"focus.ts — web-ble-monitor",
 "status":"active","screenshot":"screenshots/2026-07-18/120300.png",
 "analysis":{"summary":"Editing focus.ts, adding the fsOk sample-rate gate",
             "tags":["coding","typescript"],"model":"gemma-4-31B-it"}}
```

- **Idle minute** (unchanged frame): `"status":"idle"`, `"analysis":null`, `"screenshot":null`
  (the duplicate PNG is deleted).
- **Excluded app** (frontmost app in `excludeApps`): `"status":"excluded"`, `"analysis":null`,
  `"screenshot":null`, no capture taken.
- **Vision failure:** `"status":"active"`, `"analysis":null`, `"error":"..."`, and the PNG is kept
  so `reanalyze` can retry it later.

Daily summary — `data/YYYY-MM-DD.summary.json`:

```json
{"date":"2026-07-18","narrative":"…","shipped":["…","…"],
 "appTime":{"Code":"3h20m","Chrome":"1h05m"},"generatedAt":"2026-07-18T18:00:00-07:00"}
```

## Error handling & safety rails

- **Screen Recording permission** — the first `screencapture` may return a black/empty image until
  the terminal (or Bun) is granted Screen Recording. `capture.ts` detects this and prints the exact
  steps (System Settings → Privacy & Security → Screen Recording → enable the running app, then
  restart it). The loop keeps running rather than crashing.
- **Vision failure never crashes the loop** — 1 retry, then the entry is stored with
  `analysis:null` + `error`, PNG kept for `reanalyze`.
- **Endpoint multimodality is unverified until checked** — `bun run check` gates trust; if the
  model rejects images the tool still runs, recording app/title only.
- **Secrets** — the API key lives only in the gitignored `.env`; it is never logged and never
  committed. (Operational note: the key shared during brainstorming is live; rotate it if desired.)
- **Privacy** — everything stays local except the images sent to Inky's own endpoint. `excludeApps[]`
  skips capture entirely for sensitive apps, a `pause`/`resume` toggle suspends capture on demand,
  and `screenshots/` + `data/` are gitignored so history is never pushed.

## Testing / verification

**Unit (`bun test`):**
- `changedetect` — identical frames → unchanged; clearly different frames → changed; behavior at the
  threshold boundary.
- `store` — append then read round-trips an entry; retention purge deletes only PNGs older than the
  window and never touches JSON.
- `vision` — mocked `fetch`: parses a well-formed reply, retries once on failure, returns `null`
  after the retry fails.
- `digest` — `appTime` math from fixture entries; `shipped[]`/`narrative` shape from a mocked reply.
- `config` — env + `config.json` parsing, defaults, and `excludeApps` handling.

**Integration:** one loop iteration with a fixture PNG (stubbed capture) and a mocked endpoint →
assert exactly one JSONL line is written with the expected shape.

**End-to-end (manual):**
1. `bun run check` → confirm the endpoint accepts an image.
2. `bun start` for ~3 minutes → verify `data/<today>.jsonl` grows and `screenshots/<today>/` fills,
   with idle minutes marked `idle`.
3. `bun run server` → open `http://localhost:4319`, scroll the timeline, switch dates.
4. `bun run digest` → confirm `<today>.summary.json` has `narrative`, `shipped[]`, `appTime{}`.
5. `daemon/install.sh` → confirm the launchd agent runs at login; `uninstall.sh` removes it.

## Out of scope (v1)

Multi-monitor / all-displays capture, active-window-only capture, OCR, cross-day search, non-macOS
support, and cloud sync. Each is a possible later add-on, not part of this build.
