/**
 * Pure, Electron-free core of the Anti-Burnout tracker.
 *
 * The only signal this module ever consumes is a single number: how many
 * seconds the machine has been idle (no keyboard/mouse input). It never sees,
 * stores, or infers anything about *what* is on screen. Keeping the logic pure
 * here makes the behaviour fully unit-testable without launching Electron.
 */

/** How the recovery card escalates as a continuous active stretch grows. */
export type StretchBand =
  | "eyes"
  | "eyes-posture"
  | "eyes-posture-water"
  | "eyes-posture-water-day";

export interface TrackerConfig {
  /** Idle for >= this many seconds counts as a break (resets the stretch). */
  idleThresholdSeconds: number;
  /** Show a card after this many seconds of continuous active time. */
  reminderIntervalSeconds: number;
}

export const DEFAULT_CONFIG: TrackerConfig = {
  idleThresholdSeconds: 60, // "idle for a minute or more" => you're already away
  reminderIntervalSeconds: 20 * 60, // 20-20-20 rule: nudge every 20 active minutes
};

export interface TrackerState {
  /** Active seconds since the last real (idle) break — drives card content. */
  currentStretchSeconds: number;
  /** Total active seconds accumulated today — drives the "day's water" note. */
  todayActiveSeconds: number;
  /** True while the user is idle past the threshold (on a break). */
  onBreak: boolean;
  /** Stretch value at which we last fired a reminder, to space them out. */
  lastReminderAtStretch: number;
  /** Local calendar day (YYYY-MM-DD) the daily total belongs to. */
  dayKey: string;
}

export interface TickResult {
  /** The next state; callers persist and feed it back on the following tick. */
  state: TrackerState;
  /** True on the tick where a reminder card should be shown. */
  showCard: boolean;
  /** True on the first active tick after returning from a break. */
  justReturnedFromBreak: boolean;
}

/**
 * Build the starting state for a given calendar day.
 *
 * @param dayKey - Local day string (YYYY-MM-DD) to anchor the daily total.
 * @returns A fresh, zeroed tracker state.
 */
export const createInitialState = (dayKey: string): TrackerState => ({
  currentStretchSeconds: 0,
  todayActiveSeconds: 0,
  onBreak: false,
  lastReminderAtStretch: 0,
  dayKey,
});

/**
 * Clamp a value into an inclusive range.
 *
 * @param value - The number to clamp.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns `value` constrained to `[min, max]`.
 */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Advance the tracker by one poll.
 *
 * Idle >= threshold means the user is away: that idle period *is* the break, so
 * the current stretch resets and no card is shown. Otherwise the elapsed time
 * is added to the stretch and the day's total, and a card is requested once per
 * reminder interval.
 *
 * @precondition `elapsedSeconds >= 0` and `idleSeconds >= 0`.
 * @postcondition The returned state reflects exactly one applied tick.
 * @param state - The previous tracker state.
 * @param idleSeconds - System idle time (seconds since last HID input).
 * @param elapsedSeconds - Wall-clock seconds since the previous tick.
 * @param dayKey - Current local day string (YYYY-MM-DD).
 * @param config - Idle/reminder thresholds.
 * @returns The next state plus whether to show a card this tick.
 */
export const tick = (
  state: TrackerState,
  idleSeconds: number,
  elapsedSeconds: number,
  dayKey: string,
  config: TrackerConfig = DEFAULT_CONFIG,
): TickResult => {
  // Roll the daily total over at midnight; the stretch is independent of it.
  const rolledToday =
    dayKey === state.dayKey ? state.todayActiveSeconds : 0;

  // Idle past the threshold: the user is on a break. Reset the stretch.
  if (idleSeconds >= config.idleThresholdSeconds) {
    return {
      state: {
        ...state,
        currentStretchSeconds: 0,
        lastReminderAtStretch: 0,
        todayActiveSeconds: rolledToday,
        onBreak: true,
        dayKey,
      },
      showCard: false,
      justReturnedFromBreak: false,
    };
  }

  // Active. Never credit more than one idle-threshold's worth per tick so a
  // sleep/suspend gap (where the timer never fired) can't inflate the stretch.
  const credited = clamp(elapsedSeconds, 0, config.idleThresholdSeconds);
  const currentStretchSeconds = state.currentStretchSeconds + credited;
  const todayActiveSeconds = rolledToday + credited;

  const dueForReminder =
    currentStretchSeconds - state.lastReminderAtStretch >=
    config.reminderIntervalSeconds;

  return {
    state: {
      ...state,
      currentStretchSeconds,
      todayActiveSeconds,
      onBreak: false,
      lastReminderAtStretch: dueForReminder
        ? currentStretchSeconds
        : state.lastReminderAtStretch,
      dayKey,
    },
    showCard: dueForReminder,
    justReturnedFromBreak: state.onBreak,
  };
};

/**
 * Map a continuous active stretch to its escalation band.
 *
 * @param stretchSeconds - Continuous active time since the last break.
 * @returns The band describing which recovery steps to surface.
 */
export const bandForStretch = (stretchSeconds: number): StretchBand => {
  const minutes = stretchSeconds / 60;
  if (minutes < 45) return "eyes";
  if (minutes < 90) return "eyes-posture";
  if (minutes < 180) return "eyes-posture-water";
  return "eyes-posture-water-day";
};
