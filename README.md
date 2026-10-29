# Anti-Burnout

A tiny menu-bar / system-tray app that counts how long you've **actually** been
at the screen and, every so often, shows one short recovery card. It does not
blank or lock your screen, and it never looks at what's on it.

The break is for your eyes, your posture, and a drink of water. **That time is
not for more work.**

Runs on macOS, Windows, and Linux.

## Who it's for

People whose work has no edge any more — where the hours that used to be off
have quietly filled up with more work. This app does not try to make you more
productive. It interrupts briefly, asks for something physical, and gets out of
the way. It never adds a task, never asks a question, and never wants a reply.

## What it does

- **Counts real active time.** Idle time doesn't count. If you've used the
  machine in the last minute, that time is added to the current stretch. If
  you've been idle for a minute or more, you're already away — the stretch
  resets and no card appears.
- **Escalates the nudge** based on how long the current stretch has run:

  | Time at the screen since the last break | The card asks for |
  | --- | --- |
  | Under 45 min | **Eyes.** Look ~20 feet away for 20 seconds. |
  | 45–90 min | **Eyes, then posture.** Feet flat, shoulders dropped, screen at eye height. |
  | Over 90 min | **Eyes, posture, water,** plus one gentle movement. |
  | Over 3 hours | Same, plus a note about the day's water. |
  | After 8pm | Says the day could reasonably end here. |

- **Varies what it asks for.** Each area has several phrasings and the app
  rotates through them, so the 4pm card doesn't read exactly like the 10am one.
- **Shows a card, not a black screen.** A small, always-on-top window in the
  top-right corner, sized to its content. It appears without stealing focus,
  floats above fullscreen apps, and you dismiss it with **Done** (or **Snooze**).

## Run it

Needs [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/gmotzespina/calude-impact-lab-anti-burnout.git
cd calude-impact-lab-anti-burnout
npm install
npm start      # compiles TypeScript, then launches Electron
```

There is no window and no dock icon — look for the **eye icon** in your menu
bar (macOS) or system tray (Windows/Linux). Click it for: pause, preview the
card, start a break now, launch at login, and quit.

> **Windows 11 hides new tray icons by default.** If you don't see the eye,
> click the **`^`** chevron next to the clock — it will be in there. Drag it
> onto the taskbar to keep it visible.

> **macOS** also shows a live stretch count next to the icon. If the title is
> hidden, widen the menu bar or quit a few other menu-bar apps.

To see a card immediately without waiting 20 minutes:

```bash
npx electron . --smoke    # shows one real card, then exits
```

## Privacy — what it does *not* do

The **only** input is idle-versus-active. It comes from Electron's
`powerMonitor.getSystemIdleTime()`, which returns a single number: seconds
since the last keyboard or mouse event.

- No screen reading, no window titles, no screenshots.
- No keystroke logging — only *whether* input happened, never *what*.
- No clipboard.
- **No network at all, unless you explicitly turn on Claude cards** (below).
  Out of the box, nothing leaves your machine.

The only data written to disk are coarse counters (current stretch, today's
active total) in your app-support folder.

> Note on "reading the logs": you don't need to parse any system log. The live
> HID idle time is exposed directly and is strictly less information than a log
> would be — it's one integer, nothing about content.

## Optional: let Claude write the card

**Off by default.** The built-in exercise library is the default experience and
is not a degraded one — it works offline, forever, with no account.

If you'd rather have the wording generated fresh each time, set `useClaude` to
`true` in `config.json` (path below) and provide an Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # macOS/Linux
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # Windows PowerShell
npm start
```

**Be clear about the tradeoff — this is the one thing that uses the network.**
When it is on, each card sends three integers to the Anthropic API: minutes in
the current stretch, minutes active today, and the hour of day — plus the
wording of the last few cards, so it doesn't repeat itself. It does **not**
send screen contents, window titles, keystrokes, file paths, or the raw idle
signal. If that tradeoff isn't worth it to you, leave it off; you lose variety
and nothing else.

It is built to be unnoticeable when it fails. Suggestions are fetched in the
background before a card is due, never blocking it. No key, no network, a rate
limit, a malformed reply — any of these and you silently get the built-in
library instead. After three consecutive failures it stops trying until the next
launch, so a missing key costs you nothing on an ongoing basis.

Model: `claude-opus-5-5`. Set `ANTI_BURNOUT_MODEL` to use a cheaper tier — the
card is four short sentences, so a smaller model is a perfectly sensible choice.

## Configuration

`config.json` lives in the app-support folder:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/anti-burnout-tracker/` |
| Windows | `%APPDATA%\anti-burnout-tracker\` |
| Linux | `~/.config/anti-burnout-tracker/` |

(A packaged build uses `Anti-Burnout` instead of `anti-burnout-tracker`, since
electron-builder renames the app.)

```json
{
  "idleThresholdSeconds": 60,
  "reminderIntervalSeconds": 1200,
  "snoozeMinutes": 5,
  "useClaude": false
}
```

Lower `reminderIntervalSeconds` to 60 if you want to see the behaviour quickly.

> A UTF-8 BOM at the start of this file is tolerated, so editing it in Notepad
> or with PowerShell's `Out-File` works.

## Develop & test

```bash
npm test        # 23 Jest unit tests for the tracker, library, and card logic
npm run typecheck
npm run build   # tsc -> dist/
npm run icons   # regenerate the tray icons in assets/
npm run dist:mac   # package a .dmg   (must run on macOS)
npm run dist:win   # package an installer (must run on Windows)
```

## How it's built

- `src/tracker.ts` — pure, Electron-free state machine (idle → stretch → card
  decision). Fully unit-tested.
- `src/exercises.ts` — the built-in exercise library and the rotation that
  picks from it. Pure and unit-tested.
- `src/cardContent.ts` — assembles a card, preferring a generated suggestion
  and falling back to the library.
- `src/suggest.ts` — the optional Claude call. The only networked file; returns
  `null` on every failure so callers can ignore errors entirely.
- `src/store.ts` — tiny JSON persistence for config and daily counters.
- `src/main.ts` — Electron main: the one place the OS idle signal is read; tray,
  card window, power events.
- `src/preload.ts` — a minimal contextBridge; the renderer gets content and can
  send only "done" / "snooze" / its measured height.
- `renderer/card.html` + `renderer/card.js` — the card UI (presentation only).
- `tools/make-tray-icon.js` — generates `assets/*.png` with no image
  dependencies.

## License

MIT
