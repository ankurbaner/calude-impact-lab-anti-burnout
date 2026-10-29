import {
  tick,
  bandForStretch,
  createInitialState,
  DEFAULT_CONFIG,
  TrackerConfig,
} from "../src/tracker";
import { buildCardContent } from "../src/cardContent";

const DAY = "2026-10-29";
const cfg: TrackerConfig = { idleThresholdSeconds: 60, reminderIntervalSeconds: 1200 };

describe("tick — accumulation and idle handling", () => {
  it("adds elapsed active time to the stretch and the daily total", () => {
    const s0 = createInitialState(DAY);
    const r = tick(s0, /*idle*/ 2, /*elapsed*/ 4, DAY, cfg);
    expect(r.state.currentStretchSeconds).toBe(4);
    expect(r.state.todayActiveSeconds).toBe(4);
    expect(r.state.onBreak).toBe(false);
    expect(r.showCard).toBe(false);
  });

  it("stops adding and resets the stretch once idle reaches the threshold", () => {
    let s = createInitialState(DAY);
    // Build up five minutes of active time.
    for (let i = 0; i < 60; i++) s = tick(s, 2, 5, DAY, cfg).state;
    expect(s.currentStretchSeconds).toBe(300);

    // Now go idle for a full minute — the break.
    const r = tick(s, 60, 5, DAY, cfg);
    expect(r.state.currentStretchSeconds).toBe(0);
    expect(r.state.onBreak).toBe(true);
    expect(r.showCard).toBe(false);
  });

  it("flags justReturnedFromBreak on the first active tick after idling", () => {
    let s = createInitialState(DAY);
    s = tick(s, 90, 5, DAY, cfg).state; // on break
    const r = tick(s, 1, 5, DAY, cfg); // back at the keyboard
    expect(r.justReturnedFromBreak).toBe(true);
    expect(r.state.onBreak).toBe(false);
    expect(r.state.currentStretchSeconds).toBe(5);
  });

  it("never credits more than one idle-threshold per tick (sleep-gap guard)", () => {
    const s = createInitialState(DAY);
    // A 2-hour wall-clock gap while active should not add 2 hours.
    const r = tick(s, 1, 7200, DAY, cfg);
    expect(r.state.currentStretchSeconds).toBe(cfg.idleThresholdSeconds);
  });

  it("rolls the daily total at midnight but keeps the current stretch", () => {
    let s = createInitialState(DAY);
    for (let i = 0; i < 10; i++) s = tick(s, 2, 30, DAY, cfg).state;
    expect(s.todayActiveSeconds).toBe(300);
    const r = tick(s, 2, 30, "2026-10-30", cfg);
    expect(r.state.todayActiveSeconds).toBe(30); // reset + this tick
    expect(r.state.currentStretchSeconds).toBe(330); // stretch unaffected
  });
});

describe("tick — reminder cadence", () => {
  it("fires a card once per reminder interval, not every tick", () => {
    let s = createInitialState(DAY);
    let fires = 0;
    // 40 active minutes in 5s steps => two 20-minute intervals.
    const steps = (40 * 60) / 5;
    for (let i = 0; i < steps; i++) {
      const r = tick(s, 2, 5, DAY, cfg);
      s = r.state;
      if (r.showCard) fires++;
    }
    expect(fires).toBe(2);
  });

  it("does not fire again immediately after a break resets the stretch", () => {
    let s = createInitialState(DAY);
    const steps = (20 * 60) / 5;
    for (let i = 0; i < steps; i++) s = tick(s, 2, 5, DAY, cfg).state; // one fire consumed
    s = tick(s, 70, 5, DAY, cfg).state; // break resets
    const r = tick(s, 2, 5, DAY, cfg); // fresh stretch
    expect(r.showCard).toBe(false);
    expect(r.state.currentStretchSeconds).toBe(5);
  });
});

describe("bandForStretch — escalation thresholds", () => {
  it("maps stretch length to the right band", () => {
    expect(bandForStretch(44 * 60)).toBe("eyes");
    expect(bandForStretch(45 * 60)).toBe("eyes-posture");
    expect(bandForStretch(89 * 60)).toBe("eyes-posture");
    expect(bandForStretch(90 * 60)).toBe("eyes-posture-water");
    expect(bandForStretch(179 * 60)).toBe("eyes-posture-water");
    expect(bandForStretch(180 * 60)).toBe("eyes-posture-water-day");
  });
});

describe("buildCardContent — card copy per band", () => {
  it("under 45 min: eyes only", () => {
    const c = buildCardContent(30 * 60, 30 * 60);
    expect(c.steps).toHaveLength(1);
    expect(c.steps[0].text).toMatch(/20 feet/);
    expect(c.footnote).toBeUndefined();
  });

  it("45–90 min: eyes + posture", () => {
    const c = buildCardContent(60 * 60, 60 * 60);
    expect(c.steps).toHaveLength(2);
    expect(c.steps[1].text).toMatch(/shoulders dropped/i);
  });

  it("over 90 min: eyes + posture + water, no day note yet", () => {
    const c = buildCardContent(120 * 60, 120 * 60);
    expect(c.steps).toHaveLength(3);
    expect(c.steps[2].text).toMatch(/half a litre/i);
    expect(c.footnote).toBeUndefined();
  });

  it("over 3 hours: same three steps plus the day's-water footnote", () => {
    const c = buildCardContent(200 * 60, 260 * 60);
    expect(c.steps).toHaveLength(3);
    expect(c.footnote).toMatch(/1 litre/i);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("matches the brief: 1-minute idle, 20-minute cadence", () => {
    expect(DEFAULT_CONFIG.idleThresholdSeconds).toBe(60);
    expect(DEFAULT_CONFIG.reminderIntervalSeconds).toBe(20 * 60);
  });
});
