# memdesk

screenshots my screen every minute, figures out what i was doing, dumps it to json i can scroll through. so i can actually answer "what did i even do today".

macOS only. bun + typescript.

![the timeline](docs/ui.svg)

## the idea

every minute: grab the screen → if it actually changed since last time, read the text off it (macOS OCR, on-device) → ask the LLM "what's this person doing" → write a line to `data/YYYY-MM-DD.jsonl`. nothing happens on idle minutes so it doesn't spam the endpoint or my disk.

screenshots **stay on the machine** in the default mode — only the OCR'd text leaves. see the OCR note below for why.

## running it

```bash
bun install
cp .env.example .env      # put your endpoint + key in
bun run check             # sanity check: compiles the OCR bit, does one round trip
bun start                 # the loop. ctrl-c to stop
```

then to look at it:

```bash
bun run server            # http://localhost:4319
bun run digest            # writes today's "what i shipped" summary (pass a date for another day)
```

first run macOS will nag about Screen Recording. give it to whatever's running `bun start` (your terminal / vscode), quit + reopen it, done. if screenshots come out black that's what you missed.

leave it running all day:

```bash
bun run install-daemon    # launchd, starts at login
bun run uninstall-daemon
```

other bits: `bun run pause` / `bun run resume` (stop capturing for a bit), `bun run reanalyze` (retry the LLM on lines that failed, as long as the png's still around), `bun test`.

## the OCR thing

wanted to just send the screenshot to the model. the endpoint i'm using (vllm behind a gateway) only takes text `content` — it 400s on the image array. so instead: OCR the screenshot locally with the macOS Vision framework (tiny swift helper, compiles itself on first run — needs xcode command line tools), send the text. bonus: the images never leave.

if you've got a real multimodal endpoint, flip `"analysisMode": "vision"` in `config.json` and it sends the image instead. code's still there.

## config

optional `config.json` in the root, all keys optional (see `config.example.json`):

- `intervalSec` — 60
- `changeThreshold` — 5. how different a frame has to be to count as "changed" (higher = fewer calls, more stuff skipped)
- `retentionDays` — 14. pngs older than this get deleted. the json stays forever
- `analysisMode` — `"ocr"` (default) or `"vision"`
- `excludeApps` — `["1Password", "Messages"]`. these never get captured at all
- `display` — `"main"`
- `port` — 4319

`.env`:

```
OPENAI_BASE_URL=...
OPENAI_API_KEY=...
VISION_MODEL=gemma-4-31B-it
```

## where stuff lives

```
data/2026-07-18.jsonl          one line per minute
data/2026-07-18.summary.json   the daily digest
screenshots/2026-07-18/*.png   the frames (auto-deleted after retentionDays)
```

all gitignored. this is your screen history — don't commit it.

## not doing (yet)

multiple monitors, single-window capture, search across days, anything non-mac, cloud sync.
