# Anti-Burnout

A tiny macOS menu-bar app that counts how long you've **actually** been at the
screen and, every so often, shows one short recovery card. It does not blank or
lock your screen, and it never looks at what's on it.

The break is for your eyes, your posture, and a drink of water. **That time is
not for more work.**

## What it does

- **Counts real active time.** Idle time doesn't count. If you've used the
  machine in the last minute, that time is added to the current stretch. If
  you've been idle for a minute or more, you're already away — the stretch
  resets and no card appears.
- **Escalates the nudge** based on how long the current stretch has run:

  | Time at the screen since the last break | The card says |
  | --- | --- |
  | Under 45 min | **Eyes.** Look ~20 feet away for 20 seconds. |
  | 45–90 min | **Eyes, then posture.** Feet flat, shoulders dropped, screen at eye height. |
  | Over 90 min | **Eyes, posture, then water.** Half a litre across the next hour, sipped. |
  | Over 3 hours | Same card, plus: bring the day's water toward 1 litre, still sipped across the day. |

- **Shows a card, not a black screen.** A small, always-on-top window in the
  top-right corner. It appears without stealing focus, floats above fullscreen
  apps, and you dismiss it with **Done** (or **Snooze**).

## Privacy — what it does *not* do

The **only** input is idle-versus-active. On macOS this comes from Electron's
`powerMonitor.getSystemIdleTime()`, which returns a single number: seconds since
the last keyboard or mouse event.

- No screen reading, no window titles, no screenshots.
- No keystroke logging — only *whether* input happened, never *what*.
- No clipboard, no network. Everything stays on your machine.

The only data written to disk are coarse counters (current stretch, today's
active total) in your app-support folder.

> Note on "reading the logs": you don't need to parse any system log. The live
> HID idle time is exposed directly and is strictly less information than a log
> would be — it's one integer, nothing about content.

## Run it

```bash
npm install
npm start      # compiles TypeScript, then launches Electron
```

The app has no window and no dock icon — look for the **👁 / stretch time** in
the menu bar. Click it for: pause, preview the card, start a break now, launch
at login, and quit.

> First launch on macOS may prompt for permissions; this app needs none beyond
> running. If the menu-bar title is hidden, widen the menu bar or quit a few
> other menu-bar apps.

## Develop & test

```bash
npm test        # Jest unit tests for the pure tracker + card-content logic
npm run typecheck
npm run build   # tsc -> dist/
npm run dist    # package a .dmg via electron-builder (optional)
```

## How it's built

- `src/tracker.ts` — pure, Electron-free state machine (idle → stretch → card
  decision). Fully unit-tested.
- `src/cardContent.ts` — maps a stretch length to the card's words.
- `src/store.ts` — tiny JSON persistence for config and daily counters.
- `src/main.ts` — Electron main: the one place the OS idle signal is read; tray,
  card window, power events.
- `src/preload.ts` — a minimal contextBridge; the renderer gets content and can
  send only "done" / "snooze".
- `renderer/card.html` + `renderer/card.js` — the card UI (presentation only).

## Configuration

Thresholds live in `config.json` in the app-support folder —
`~/Library/Application Support/anti-burnout-tracker/` when run with
`npm start`, or `~/Library/Application Support/Anti-Burnout/` in a packaged
(`npm run dist`) build, since electron-builder renames the app:

```json
{
  "idleThresholdSeconds": 60,
  "reminderIntervalSeconds": 1200,
  "snoozeMinutes": 5
}
```

## License

MIT
