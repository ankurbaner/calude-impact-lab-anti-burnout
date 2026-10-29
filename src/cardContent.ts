/**
 * Turns a stretch length into the exact words shown on the recovery card.
 *
 * The copy mirrors the brief: the break is for your eyes, your posture, and a
 * drink of water — it is deliberately *not* an invitation to do more work.
 * Content lives here (not in the renderer) so it is testable and single-source.
 *
 * Two sources feed this, in order of preference:
 *   1. A Claude-generated suggestion, when one has been prefetched.
 *   2. The built-in library in `exercises.ts`, which always works offline.
 * The second is not a degraded mode — it is the documented default.
 */
import { StretchBand, bandForStretch } from "./tracker";
import { Exercise, selectExercises } from "./exercises";

export interface CardStep {
  /** A single emoji used as the step's glyph in the UI. */
  icon: string;
  /** The instruction for this step. */
  text: string;
}

export interface CardContent {
  band: StretchBand;
  /** Minutes in the current continuous stretch (rounded). */
  stretchMinutes: number;
  /** Total active minutes today (rounded). */
  todayMinutes: number;
  heading: string;
  steps: CardStep[];
  /** Optional closing line (used once the day gets long). */
  footnote?: string;
  /** True when the steps came from Claude rather than the built-in library. */
  generated: boolean;
}

const DAY_WATER_FOOTNOTE =
  "You've been at it a while today. Bring the day's water toward 1 litre — still sipped, across the day.";

/** Said once the evening is clearly being eaten by the work. */
const LATE_FOOTNOTE =
  "It's late. This is a good place to stop — the rest will still be here tomorrow.";

const HEADING_BY_BAND: Record<StretchBand, string> = {
  "eyes": "Rest your eyes",
  "eyes-posture": "Eyes, then posture",
  "eyes-posture-water": "Eyes, posture, then water",
  "eyes-posture-water-day": "Eyes, posture, then water",
};

export interface BuildOptions {
  /** How many cards have already been shown; rotates the built-in wording. */
  rotation?: number;
  /** Local hour 0-23, used for the late-evening line. Defaults to now. */
  hourOfDay?: number;
  /** Pre-generated steps from Claude. Falls back to the library when absent. */
  generated?: { steps: Exercise[]; footnote?: string } | null;
}

/**
 * Build the card content for a given active stretch.
 *
 * @precondition `stretchSeconds >= 0` and `todayActiveSeconds >= 0`.
 * @param stretchSeconds - Continuous active time since the last break.
 * @param todayActiveSeconds - Total active time accumulated today.
 * @param options - Rotation, clock hour, and any prefetched suggestion.
 * @returns A fully-resolved {@link CardContent} ready to render.
 */
export const buildCardContent = (
  stretchSeconds: number,
  todayActiveSeconds: number,
  options: BuildOptions = {},
): CardContent => {
  const band = bandForStretch(stretchSeconds);
  const stretchMinutes = Math.round(stretchSeconds / 60);
  const todayMinutes = Math.round(todayActiveSeconds / 60);
  const rotation = options.rotation ?? 0;
  const hour = options.hourOfDay ?? new Date().getHours();

  const generated = options.generated;
  const usingGenerated = Boolean(generated && generated.steps.length > 0);

  const source: Exercise[] = usingGenerated
    ? generated!.steps
    : selectExercises(stretchSeconds, rotation);

  const steps: CardStep[] = source.map(({ icon, text }) => ({ icon, text }));

  // A generated card brings its own closing line; otherwise pick the one the
  // situation calls for. Late evening outranks the day's-water note, because
  // stopping matters more than hydrating at that point.
  let footnote: string | undefined;
  if (usingGenerated) {
    footnote = generated!.footnote;
  } else if (hour >= 20 || hour < 5) {
    footnote = LATE_FOOTNOTE;
  } else if (band === "eyes-posture-water-day") {
    footnote = DAY_WATER_FOOTNOTE;
  }

  return {
    band,
    stretchMinutes,
    todayMinutes,
    heading: HEADING_BY_BAND[band],
    steps,
    footnote,
    generated: usingGenerated,
  };
};
