import {
  tick,
  bandForStretch,
  createInitialState,
  DEFAULT_CONFIG,
  TrackerConfig,
} from "../src/tracker";
import { buildCardContent } from "../src/cardContent";
import { selectExercises, allExercises, MAX_STEPS } from "../src/exercises";

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
  // Pin the hour: the late-evening footnote is time-dependent, and a test
  // that passes only before 8pm is worse than no test.
  const DAYTIME = { rotation: 0, hourOfDay: 14 };

  it("under 45 min: eyes only", () => {
    const c = buildCardContent(30 * 60, 30 * 60, DAYTIME);
    expect(c.steps).toHaveLength(1);
    expect(c.steps[0].text).toMatch(/20 feet/);
    expect(c.footnote).toBeUndefined();
    expect(c.generated).toBe(false);
  });

  it("45–90 min: eyes + posture", () => {
    const c = buildCardContent(60 * 60, 60 * 60, DAYTIME);
    expect(c.steps).toHaveLength(2);
    expect(c.steps[1].text).toMatch(/shoulders dropped/i);
  });

  it("over 90 min: eyes, posture, water, plus a movement step", () => {
    const c = buildCardContent(120 * 60, 120 * 60, DAYTIME);
    expect(c.steps).toHaveLength(4);
    expect(c.steps[2].text).toMatch(/half a litre/i);
    expect(c.footnote).toBeUndefined();
  });

  it("over 3 hours: four steps plus the day's-water footnote", () => {
    const c = buildCardContent(200 * 60, 260 * 60, DAYTIME);
    expect(c.steps).toHaveLength(4);
    expect(c.footnote).toMatch(/1 litre/i);
  });

  it("never exceeds the four-step cap, at any band or rotation", () => {
    for (let rotation = 0; rotation < 12; rotation++) {
      for (const minutes of [10, 50, 120, 200, 400]) {
        const c = buildCardContent(minutes * 60, minutes * 60, {
          rotation,
          hourOfDay: 14,
        });
        expect(c.steps.length).toBeGreaterThan(0);
        expect(c.steps.length).toBeLessThanOrEqual(MAX_STEPS);
      }
    }
  });

  it("late in the evening it says the day can end, outranking the water note", () => {
    const c = buildCardContent(200 * 60, 400 * 60, { rotation: 0, hourOfDay: 22 });
    expect(c.footnote).toMatch(/good place to stop/i);
  });
});

describe("buildCardContent — rotation and variety", () => {
  it("does not repeat the same wording on consecutive cards", () => {
    const first = buildCardContent(60 * 60, 60 * 60, { rotation: 0, hourOfDay: 14 });
    const second = buildCardContent(60 * 60, 60 * 60, { rotation: 1, hourOfDay: 14 });
    expect(second.steps[0].text).not.toBe(first.steps[0].text);
  });

  it("is deterministic — the same rotation always gives the same card", () => {
    const a = buildCardContent(120 * 60, 120 * 60, { rotation: 3, hourOfDay: 14 });
    const b = buildCardContent(120 * 60, 120 * 60, { rotation: 3, hourOfDay: 14 });
    expect(b.steps).toEqual(a.steps);
  });

  it("cycles through every eye variant before repeating one", () => {
    const seen = new Set<string>();
    for (let rotation = 0; rotation < 4; rotation++) {
      seen.add(selectExercises(30 * 60, rotation)[0].text);
    }
    expect(seen.size).toBe(4);
  });

  it("every library entry is a non-empty sentence with an icon", () => {
    for (const ex of allExercises()) {
      expect(ex.icon.length).toBeGreaterThan(0);
      expect(ex.text.trim().length).toBeGreaterThan(0);
      expect(ex.text.length).toBeLessThanOrEqual(90);
    }
  });
});

describe("buildCardContent — generated suggestions", () => {
  const generated = {
    steps: [
      { icon: "👁️", text: "Soften your focus on the far wall.", focus: "eyes" as const },
      { icon: "🚶", text: "Stand and walk to the window.", focus: "movement" as const },
    ],
    footnote: "That is enough for now.",
  };

  it("prefers a generated suggestion over the built-in library", () => {
    const c = buildCardContent(60 * 60, 60 * 60, { rotation: 0, hourOfDay: 14, generated });
    expect(c.generated).toBe(true);
    expect(c.steps).toHaveLength(2);
    expect(c.steps[0].text).toBe("Soften your focus on the far wall.");
    expect(c.footnote).toBe("That is enough for now.");
  });

  it("falls back to the library when generation returned nothing", () => {
    const c = buildCardContent(60 * 60, 60 * 60, {
      rotation: 0,
      hourOfDay: 14,
      generated: null,
    });
    expect(c.generated).toBe(false);
    expect(c.steps).toHaveLength(2);
    expect(c.steps[0].text).toMatch(/20 feet/);
  });

  it("falls back when generation returned an empty step list", () => {
    const c = buildCardContent(60 * 60, 60 * 60, {
      rotation: 0,
      hourOfDay: 14,
      generated: { steps: [], footnote: "ignored" },
    });
    expect(c.generated).toBe(false);
    expect(c.steps[0].text).toMatch(/20 feet/);
    expect(c.footnote).toBeUndefined();
  });

  it("keeps the band and counters even when the steps are generated", () => {
    const c = buildCardContent(200 * 60, 400 * 60, { rotation: 0, hourOfDay: 14, generated });
    expect(c.band).toBe("eyes-posture-water-day");
    expect(c.stretchMinutes).toBe(200);
    expect(c.todayMinutes).toBe(400);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("matches the brief: 1-minute idle, 20-minute cadence", () => {
    expect(DEFAULT_CONFIG.idleThresholdSeconds).toBe(60);
    expect(DEFAULT_CONFIG.reminderIntervalSeconds).toBe(20 * 60);
  });
});
