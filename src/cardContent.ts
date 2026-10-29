/**
 * Turns a stretch band into the exact words shown on the recovery card.
 *
 * The copy mirrors the brief: the break is for your eyes, your posture, and a
 * drink of water — it is deliberately *not* an invitation to do more work.
 * Content lives here (not in the renderer) so it is testable and single-source.
 */
import { StretchBand, bandForStretch } from "./tracker";

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
}

const EYE_STEP: CardStep = {
  icon: "👁️",
  text: "Look at something about 20 feet away for 20 seconds.",
};

const POSTURE_STEP: CardStep = {
  icon: "🪑",
  text: "Feet flat, shoulders dropped, screen at eye height.",
};

const WATER_STEP: CardStep = {
  icon: "💧",
  text: "Half a litre across the next hour — sipped, not downed in one go.",
};

const DAY_WATER_FOOTNOTE =
  "You've been at it a while today. Bring the day's water toward 1 litre — still sipped, across the day.";

/**
 * Build the card content for a given active stretch.
 *
 * @precondition `stretchSeconds >= 0` and `todayActiveSeconds >= 0`.
 * @param stretchSeconds - Continuous active time since the last break.
 * @param todayActiveSeconds - Total active time accumulated today.
 * @returns A fully-resolved {@link CardContent} ready to render.
 */
export const buildCardContent = (
  stretchSeconds: number,
  todayActiveSeconds: number,
): CardContent => {
  const band = bandForStretch(stretchSeconds);
  const stretchMinutes = Math.round(stretchSeconds / 60);
  const todayMinutes = Math.round(todayActiveSeconds / 60);

  const steps: CardStep[] = [EYE_STEP];
  if (band !== "eyes") steps.push(POSTURE_STEP);
  if (band === "eyes-posture-water" || band === "eyes-posture-water-day") {
    steps.push(WATER_STEP);
  }

  const headingByBand: Record<StretchBand, string> = {
    "eyes": "Rest your eyes",
    "eyes-posture": "Eyes, then posture",
    "eyes-posture-water": "Eyes, posture, then water",
    "eyes-posture-water-day": "Eyes, posture, then water",
  };

  return {
    band,
    stretchMinutes,
    todayMinutes,
    heading: headingByBand[band],
    steps,
    footnote: band === "eyes-posture-water-day" ? DAY_WATER_FOOTNOTE : undefined,
  };
};
