/**
 * Electron main process — the only place that touches the OS and the only
 * place a "real" idle reading is taken.
 *
 * Privacy contract: the single input is `powerMonitor.getSystemIdleTime()`,
 * which returns one integer — seconds since the last keyboard/mouse event.
 * Nothing here reads window titles, keystrokes, the screen, or the clipboard.
 */
import {
  app,
  Tray,
  Menu,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  nativeImage,
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

const POLL_MS = 4000;
const CARD_WIDTH = 380;
const CARD_HEIGHT = 300;
const CARD_MARGIN = 20;

let tray: Tray | null = null;
let cardWindow: BrowserWindow | null = null;
let cardReady: Promise<void> | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastTickMs = Date.now();
let paused = false;

let userDataDir = "";
let config: AppConfig;
let state: TrackerState;

const persist = (): void => saveState(userDataDir, state);

/**
 * Resolve the recovery-card HTML path for both dev and packaged runs.
 */
const rendererFile = (name: string): string =>
  path.join(app.getAppPath(), "renderer", name);

// --- Card window ------------------------------------------------------------

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
    height: CARD_HEIGHT,
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

  void cardWindow.loadFile(rendererFile("card.html"));
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

const formatMinutes = (seconds: number): string => {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
};

/**
 * macOS shows the stretch as menu-bar text via `setTitle`. Windows and Linux
 * have no tray text, so they need a visible icon and put the stretch in the
 * tooltip instead.
 */
const IS_MAC = process.platform === "darwin";

/**
 * Draw a filled circle as a 32×32 bitmap (scale factor 2 → 16pt tray icon).
 * R and B are kept equal so the colour is the same whether the platform
 * reads the buffer as RGBA or BGRA.
 */
const circleIcon = (rb: number, g: number): Electron.NativeImage => {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // 1px soft edge for anti-aliasing.
      const alpha = Math.max(0, Math.min(1, r - d + 0.5));
      const i = (y * size + x) * 4;
      // Premultiplied alpha, as Skia expects.
      buf[i] = Math.round(rb * alpha);
      buf[i + 1] = Math.round(g * alpha);
      buf[i + 2] = Math.round(rb * alpha);
      buf[i + 3] = Math.round(255 * alpha);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
};

const ICONS = IS_MAC
  ? null
  : {
      active: circleIcon(80, 175), // green
      onBreak: circleIcon(150, 150), // grey
      paused: circleIcon(200, 200), // light grey
    };

const refreshTray = (): void => {
  if (!tray) return;
  const title = paused
    ? "⏸ Anti-Burnout"
    : state.onBreak
      ? "☕︎ on a break"
      : `👁 ${formatMinutes(state.currentStretchSeconds)}`;
  if (IS_MAC) {
    tray.setTitle(` ${title}`);
  } else if (ICONS) {
    tray.setImage(paused ? ICONS.paused : state.onBreak ? ICONS.onBreak : ICONS.active);
    tray.setToolTip(
      paused
        ? "Anti-Burnout — paused"
        : state.onBreak
          ? "Anti-Burnout — on a break"
          : `Anti-Burnout — this stretch: ${formatMinutes(state.currentStretchSeconds)} · today: ${formatMinutes(state.todayActiveSeconds)}`,
    );
  }

  const menu = Menu.buildFromTemplate([
    {
      label: paused
        ? "Tracking paused"
        : `This stretch: ${formatMinutes(state.currentStretchSeconds)}  ·  today: ${formatMinutes(state.todayActiveSeconds)}`,
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
        void showCard(
          buildCardContent(state.currentStretchSeconds, state.todayActiveSeconds),
        );
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
    void showCard(
      buildCardContent(state.currentStretchSeconds, state.todayActiveSeconds),
    );
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

    tray = new Tray(ICONS ? ICONS.active : nativeImage.createEmpty());
    tray.setToolTip("Anti-Burnout — real screen time, with recovery nudges");
    // On Windows a left-click doesn't open the context menu by default.
    if (!IS_MAC) tray.on("click", () => tray?.popUpContextMenu());

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

    powerMonitor.on("suspend", markAway);
    powerMonitor.on("lock-screen", markAway);
    powerMonitor.on("resume", () => {
      lastTickMs = Date.now();
    });

    lastTickMs = Date.now();
    refreshTray();
    poll();
    pollTimer = setInterval(poll, POLL_MS);

    // Smoke test: boot everything, show a card, then quit — used by CI/dev to
    // confirm the main process initialises without crashing.
    if (process.argv.includes("--smoke")) {
      void showCard(buildCardContent(50 * 60, 50 * 60)).then(() => {
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
