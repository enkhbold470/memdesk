# contributing

thanks for looking. this is a small tool with a narrow scope — a local screenshot
journal for macOS — so the most useful contributions are bug fixes, better
handling of the messy parts (permissions, providers that half-work), and tests.

## getting set up

```bash
bun install
cp .env.example .env      # your endpoint + key, or leave blank and use ollama
bun run check             # compiles the OCR helper, does one round trip
bun test
```

macOS only, and you need Xcode command line tools for the OCR helper (`xcode-select
--install`). first run will ask for Screen Recording permission — grant it to
whatever is running `bun start` (your terminal, vscode), then quit and reopen that
app. black screenshots means you missed this.

## before you open a PR

```bash
bun run typecheck
bun test
```

CI runs both on macOS, plus it compiles `ocr/ocr.swift`. that's the whole gate.

## working on it without recording your own screen

the timeline renders your actual screen history, so don't screenshot it for an
issue or a PR. there's a synthetic dataset for exactly that:

```bash
bun run demo          # generates a fake couple of days under demo/ and serves them
bun run demo:serve    # re-serve without regenerating
```

it never reads or writes `data/` or `screenshots/`. every entry carries
`synthetic: true` and the UI shows a **demo data** pill. **leave that pill in.** a
timeline is a claim about how someone spent their day, and a fabricated one has to
say so.

## things that are deliberate

please don't "fix" these without opening an issue first — each one is a decision,
not an oversight:

- **screenshots never leave the machine in the default mode.** the image is OCR'd
  locally with the macOS Vision framework and only the text is sent. `"analysisMode":
  "vision"` exists for people with a real multimodal endpoint, but it is not the
  default and shouldn't become one.
- **cloud first, local fallback.** a local model big enough to be useful competes
  with your actual work for RAM, so it only spins up when it's the only option. the
  health check reads a manifest — it does not load the weights.
- **idle minutes do nothing.** if the frame hasn't changed past `changeThreshold`,
  there's no model call and no PNG on disk. keep it that way; it's the difference
  between this being usable all day and not.
- **every entry records which backend answered it.** `analysis.provider` is
  provenance, not decoration. don't drop it to tidy up the JSON.
- **excluded apps are never captured at all** — not captured-then-discarded.

## scope

things that fit: capture reliability, provider handling, the timeline UI, tests,
docs, making failure modes legible.

things that probably don't: cross-platform support (the capture and OCR paths are
both platform APIs), a hosted/sync component, anything that uploads images by
default.

not sure? open an issue and ask before writing the code.
