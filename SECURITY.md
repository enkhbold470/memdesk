# security

## reporting

use GitHub's [private vulnerability reporting](https://github.com/enkhbold470/memdesk/security/advisories/new)
on this repo. please don't open a public issue for anything that could expose
someone's screen history or credentials.

no bounty, no SLA — it's a side project. but I'll read it and respond.

## what this software actually does with your data

worth being explicit, because "screenshots your screen every minute" deserves it.

**stays on your machine:**

- the PNGs, under `screenshots/`. deleted after `retentionDays` (default 14).
- the JSON log, under `data/`. kept forever unless you delete it.
- your API key, in `.env`, which is gitignored.

**leaves your machine:**

- in the default `"analysisMode": "ocr"` — only the text OCR'd off each changed
  frame, sent to whichever endpoint answered that minute.
- in `"analysisMode": "vision"` — the image itself. this is not the default and
  you have to turn it on.
- nothing at all if you pin `"provider": "local"` and run ollama.

`analysis.provider` on every entry records which backend saw that minute, so you
can always audit where a given frame's text went.

**never captured:**

- any frame where an app in `excludeApps` is frontmost (default `1Password`,
  `Messages`). the screenshot is not taken, not written, and not analyzed.
- unchanged frames, and blank ones.

## if you're running this

- **add your sensitive apps to `excludeApps`** before you leave it running. the
  defaults are a starting point, not a policy.
- **`data/` and `screenshots/` are gitignored for a reason.** don't force-add
  them. `git status` in this repo should never list a day's history.
- **don't record the timeline UI to share it** — that publishes whatever was on
  your screen. `bun run demo` exists for that.
- the OCR text is sent to an endpoint you configure. memdesk doesn't ship a
  default host and doesn't phone anywhere else.

## known limits

- macOS gives Screen Recording permission to the *parent process*, so whatever
  runs `bun start` can capture your screen. granting it to your terminal grants it
  to everything you run there. that's macOS's model, not something this can fix.
- there's no encryption at rest. the PNGs and JSON sit in the repo directory with
  normal file permissions. FileVault is doing the work here, not memdesk.
