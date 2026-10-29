/**
 * Electron main process — the only place that touches the OS and the only
 * place a "real" idle reading is taken.
 *
 * Privacy contract: the single OS input is `powerMonitor.getSystemIdleTime()`,
 * which returns one integer — seconds since the last keyboard/mouse event.
 * Nothing here reads window titles, keystrokes, the screen, or the clipboard.
 *
 * One optional exception, off by default: when `useClaude` is enabled in
 * config.json, the minute counters derived from that idle signal are sent to
 * the Claude API to write the card. That is the only outbound network call
 * the app can ever make, and it stays off until the user turns it on.
 */
import {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  nativeImage,
  NativeImage,
  screen,
} from "electron";
import * as path from "path";
import {
  tick,
  createInitialState,
  TrackerState,
} from "./tracker";
import { buildCardContent, CardContent } from "./cardContent";
import {
  AppConfig,
  loadConfig,
  loadState,
  saveState,
  dayKeyOf,
} from "./store";
import { Suggestion, generateSuggestion } from "./suggest";

const POLL_MS = 4000;
const CARD_WIDTH = 380;
const CARD_MIN_HEIGHT = 160;
const CARD_MAX_HEIGHT = 560;
/** Height used before the renderer reports its measurement. */
const CARD_INITIAL_HEIGHT = 300;
const CARD_MARGIN = 20;
/** How many recent card texts to show the generator so it varies its wording. */
const RECENT_MEMORY = 4;

let tray: Tray | null = null;
let cardWindow: BrowserWindow | null = null;
let cardReady: Promise<void> | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastTickMs = Date.now();
let paused = false;

let userDataDir = "";
let config: AppConfig;
let state: TrackerState;

/** Cards shown since launch; rotates the built-in library's wording. */
let rotation = 0;
/** Wording of the last few cards, so a generated one can differ from them. */
let recentTexts: string[] = [];
/** A suggestion fetched ahead of time, consumed by the next card. */
let pendingSuggestion: Suggestion | null = null;
/** Guards against overlapping prefetches. */
let prefetchInFlight = false;
/**
 * Consecutive generation failures. After a few we stop trying for this run:
 * if there is no usable credential the answer will not change, and the
 * built-in library is a perfectly good card.
 */
let suggestionFailures = 0;
const MAX_SUGGESTION_FAILURES = 3;

const persist = (): void => saveState(userDataDir, state);

/**
 * Resolve a bundled asset path for both dev and packaged runs.
 */
const assetFile = (...parts: string[]): string =>
  path.join(app.getAppPath(), ...parts);

// --- Suggestions ------------------------------------------------------------

/**
 * True when Claude-written cards should be attempted.
 *
 * Note this deliberately does not check for an API key: the SDK resolves
 * credentials from the environment *or* a logged-in profile on disk, so the
 * only honest test is to make the call. The circuit breaker below is what
 * stops us retrying forever when there is nothing to authenticate with.
 */
const claudeEnabled = (): boolean =>
  config.useClaude && suggestionFailures < MAX_SUGGESTION_FAILURES;

/**
 * Fetch the next card's suggestion in the background.
 *
 * Deliberately fire-and-forget: the card never waits on this. If it hasn't
 * landed by the time a card is due, the built-in library is used instead and
 * the result is simply kept for the card after that.
 */
const prefetchSuggestion = (): void => {
  if (!claudeEnabled() || prefetchInFlight || pendingSuggestion) return;
  prefetchInFlight = true;
  void generateSuggestion({
    stretchMinutes: Math.round(state.currentStretchSeconds / 60),
    todayMinutes: Math.round(state.todayActiveSeconds / 60),
    hourOfDay: new Date().getHours(),
    recentTexts,
  })
    .then((result) => {
      pendingSuggestion = result;
      if (result) suggestionFailures = 0;
      else suggestionFailures += 1;
    })
    .finally(() => {
      prefetchInFlight = false;
    });
};

/**
 * Assemble the card for the current state, consuming a prefetched suggestion
 * if one is ready.
 */
const currentCardContent = (): CardContent => {
  const generated = pendingSuggestion;
  pendingSuggestion = null;

  const content = buildCardContent(
    state.currentStretchSeconds,
    state.todayActiveSeconds,
    { rotation, hourOfDay: new Date().getHours(), generated },
  );

  rotation += 1;
  recentTexts = [...content.steps.map((s) => s.text), ...recentTexts].slice(
    0,
    RECENT_MEMORY,
  );
  // Start the next one now so it is ready well before the next reminder.
  prefetchSuggestion();
  return content;
};

// --- Card window ------------------------------------------------------------

/** Place the card against the top-right of the work area at a given height. */
const positionCard = (height: number): void => {
  if (!cardWindow) return;
  const { x, y, width } = screen.getPrimaryDisplay().workArea;
  cardWindow.setBounds({
    width: CARD_WIDTH,
    height,
    x: x + width - CARD_WIDTH - CARD_MARGIN,
    y: y + CARD_MARGIN,
  });
};

/**
 * Lazily create the (hidden) card window, loaded once and then reused.
 *
 * @returns A promise that resolves when the renderer has finished loading.
 */
const ensureCardWindow = (): Promise<void> => {
  if (cardWindow && cardReady) return cardReady;

  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;

  cardWindow = new BrowserWindow({
    width: CARD_WIDTH,
    height: CARD_INITIAL_HEIGHT,
    x: x + width - CARD_WIDTH - CARD_MARGIN,
    y: y + CARD_MARGIN,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above other windows — including fullscreen apps — without stealing
  // focus or blanking anything.
  cardWindow.setAlwaysOnTop(true, "screen-saver");
  cardWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  cardWindow.on("closed", () => {
    cardWindow = null;
    cardReady = null;
  });

  cardReady = new Promise<void>((resolve) => {
    cardWindow?.webContents.once("did-finish-load", () => resolve());
  });

  void cardWindow.loadFile(assetFile("renderer", "card.html"));
  return cardReady;
};

/**
 * Show the recovery card with content derived from the current stretch.
 */
const showCard = async (content: CardContent): Promise<void> => {
  await ensureCardWindow();
  if (!cardWindow) return;
  cardWindow.webContents.send("card:content", content);
  // showInactive keeps the user's current app focused — this is a nudge, not a
  // takeover.
  cardWindow.showInactive();
};

const hideCard = (): void => {
  if (cardWindow && cardWindow.isVisible()) cardWindow.hide();
};

// --- Tray -------------------------------------------------------------------

/**
 * Build the menu-bar icon.
 *
 * macOS gets a template image, which the system recolours for light and dark
 * menu bars; it is also the only platform where `tray.setTitle` renders text,
 * so there the glyph sits next to a live stretch count. Everywhere else the
 * icon is the entire indicator, so it must be a real, visible image — an empty
 * one leaves the user with no way to reach the menu at all.
 */
const buildTrayIcon = (): NativeImage => {
  const file =
    process.platform === "darwin" ? "trayTemplate.png" : "tray-light.png";
  const image = nativeImage.createFromPath(assetFile("assets", file));
  if (image.isEmpty()) return image;
  const sized = image.resize({ width: 16, height: 16 });
  if (process.platform === "darwin") sized.setTemplateImage(true);
  return sized;
};

const formatMinutes = (seconds: number): string => {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
};

/** The one-line summary shown in the menu bar (macOS) and tooltip (all). */
const statusLine = (): string => {
  if (paused) return "Anti-Burnout — paused";
  if (state.onBreak) return "Anti-Burnout — on a break";
  return `Anti-Burnout — ${formatMinutes(state.currentStretchSeconds)} at the screen`;
};

const refreshTray = (): void => {
  if (!tray) return;

  // setTitle is macOS-only; on Windows and Linux the icon plus this tooltip
  // are the whole indicator.
  if (process.platform === "darwin") {
    const title = paused
      ? "⏸"
      : state.onBreak
        ? "☕︎ on a break"
        : `${formatMinutes(state.currentStretchSeconds)}`;
    tray.setTitle(` ${title}`);
  }
  tray.setToolTip(statusLine());

  const menu = Menu.buildFromTemplate([
    {
      label: paused
        ? "Tracking paused"
        : `This stretch: ${formatMinutes(state.currentStretchSeconds)}  ·  today: ${formatMinutes(state.todayActiveSeconds)}`,
      enabled: false,
    },
    {
      label: claudeEnabled()
        ? "Cards written by Claude"
        : "Cards from the built-in library",
      enabled: false,
    },
    { type: "separator" },
    {
      label: paused ? "Resume tracking" : "Pause tracking",
      click: () => {
        paused = !paused;
        if (paused) hideCard();
        lastTickMs = Date.now();
        refreshTray();
      },
    },
    {
      label: "Preview card",
      click: () => {
        void showCard(currentCardContent());
      },
    },
    {
      label: "Start a break now",
      toolTip: "Mark yourself away — resets the current stretch.",
      click: () => {
        state = { ...state, currentStretchSeconds: 0, lastReminderAtStretch: 0, onBreak: true };
        hideCard();
        persist();
        refreshTray();
      },
    },
    { type: "separator" },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quit Anti-Burnout", role: "quit" },
  ]);
  tray.setContextMenu(menu);
};

// --- Poll loop --------------------------------------------------------------

const poll = (): void => {
  const now = Date.now();
  const elapsedSeconds = (now - lastTickMs) / 1000;
  lastTickMs = now;

  if (paused) {
    refreshTray();
    return;
  }

  const idleSeconds = powerMonitor.getSystemIdleTime();
  const result = tick(state, idleSeconds, elapsedSeconds, dayKeyOf(), config);
  state = result.state;

  if (state.onBreak) hideCard();

  if (result.showCard && (!cardWindow || !cardWindow.isVisible())) {
    void showCard(currentCardContent());
  }

  persist();
  refreshTray();
};

/**
 * Treat system sleep / screen lock as a break — the user is unambiguously away.
 */
const markAway = (): void => {
  state = { ...state, currentStretchSeconds: 0, lastReminderAtStretch: 0, onBreak: true };
  hideCard();
  persist();
  refreshTray();
};

// --- Lifecycle --------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    // Menu-bar-only app: no dock icon, no main window.
    app.dock?.hide();

    userDataDir = app.getPath("userData");
    config = loadConfig(userDataDir);
    const fresh = createInitialState(dayKeyOf());
    state = loadState(userDataDir, fresh);
    // If the persisted state is from an earlier day, roll its daily total.
    if (state.dayKey !== fresh.dayKey) {
      state = { ...state, dayKey: fresh.dayKey, todayActiveSeconds: 0 };
    }

    tray = new Tray(buildTrayIcon());
    tray.setToolTip(statusLine());
    // On Windows a left-click should do something; the menu is all there is.
    tray.on("click", () => tray?.popUpContextMenu());

    ipcMain.on("card:done", () => hideCard());
    ipcMain.on("card:snooze", () => {
      // Pull the next reminder to `snoozeMinutes` from now instead of a full
      // interval away.
      const snoozeSeconds = config.snoozeMinutes * 60;
      state = {
        ...state,
        lastReminderAtStretch:
          state.currentStretchSeconds + snoozeSeconds - config.reminderIntervalSeconds,
      };
      persist();
      hideCard();
    });
    ipcMain.on("card:height", (_event, height: unknown) => {
      if (typeof height !== "number" || !Number.isFinite(height)) return;
      positionCard(
        Math.round(Math.min(Math.max(height, CARD_MIN_HEIGHT), CARD_MAX_HEIGHT)),
      );
    });

    powerMonitor.on("suspend", markAway);
    powerMonitor.on("lock-screen", markAway);
    powerMonitor.on("resume", () => {
      lastTickMs = Date.now();
    });

    lastTickMs = Date.now();
    refreshTray();
    poll();
    prefetchSuggestion();
    pollTimer = setInterval(poll, POLL_MS);

    // Smoke test: boot everything, show a card, then quit — used by CI/dev to
    // confirm the main process initialises without crashing.
    if (process.argv.includes("--smoke")) {
      void showCard(
        buildCardContent(50 * 60, 50 * 60, { rotation, hourOfDay: 14 }),
      ).then(() => {
        setTimeout(() => {
          console.log("ANTI_BURNOUT_SMOKE_OK");
          app.quit();
        }, 1500);
      });
    }
  });

  app.on("window-all-closed", () => {
    // Menu-bar app stays alive when the (hidden) card window closes.
  });

  app.on("before-quit", () => {
    if (pollTimer) clearInterval(pollTimer);
    persist();
  });
}
