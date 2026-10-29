/**
 * The built-in recovery-exercise library.
 *
 * This is the app's floor, not its ceiling: it runs with no network, no API
 * key, and no configuration, and it is what the card falls back to whenever a
 * generated suggestion is unavailable. Keeping it pure (no Electron, no I/O)
 * means the whole selection path is unit-testable.
 *
 * The escalation contract is unchanged from the original card — eyes, then
 * posture, then water — but each focus area now holds several phrasings so the
 * same two sentences don't repeat every twenty minutes all day.
 */
import { StretchBand, bandForStretch } from "./tracker";

/** A recovery area the card can ask for. */
export type Focus =
  | "eyes"
  | "posture"
  | "water"
  | "movement"
  | "hands"
  | "breathing";

export interface Exercise {
  /** A single emoji used as the step's glyph in the UI. */
  icon: string;
  /** The instruction shown to the user. */
  text: string;
  /** Which recovery area this belongs to. */
  focus: Focus;
}

/**
 * Variants per focus area. Order is the rotation order, so the first entry of
 * each list is the one a first-time user sees — keep the plainest phrasing
 * first.
 */
const POOL: Record<Focus, Exercise[]> = {
  eyes: [
    { icon: "👁️", text: "Look at something about 20 feet away for 20 seconds.", focus: "eyes" },
    { icon: "👁️", text: "Find the furthest thing you can see and rest on it for 20 seconds.", focus: "eyes" },
    { icon: "👁️", text: "Close your eyes and cup your palms over them for 20 seconds.", focus: "eyes" },
    { icon: "👁️", text: "Blink slowly ten times, then look out a window for 20 seconds.", focus: "eyes" },
  ],
  posture: [
    { icon: "🪑", text: "Feet flat, shoulders dropped, screen at eye height.", focus: "posture" },
    { icon: "🪑", text: "Sit back into the chair. Let your shoulders fall away from your ears.", focus: "posture" },
    { icon: "🧍", text: "Stand up while you read this. Let your spine lengthen.", focus: "posture" },
    { icon: "🪑", text: "Uncross your legs, plant both feet, and unclench your jaw.", focus: "posture" },
  ],
  water: [
    { icon: "💧", text: "Half a litre across the next hour — sipped, not downed in one go.", focus: "water" },
    { icon: "💧", text: "Refill your glass now so the next hour is already covered.", focus: "water" },
    { icon: "💧", text: "A glass of water, slowly. Thirst shows up as tiredness first.", focus: "water" },
  ],
  movement: [
    { icon: "🤸", text: "Roll your shoulders backwards five times, slowly.", focus: "movement" },
    { icon: "🚶", text: "Walk to another room and back before you sit down again.", focus: "movement" },
    { icon: "🤸", text: "Turn your head slowly left, then right. Don't force the range.", focus: "movement" },
    { icon: "🚶", text: "Stand and reach overhead, then let your arms drop loose.", focus: "movement" },
  ],
  hands: [
    { icon: "🖐️", text: "Open and close your hands ten times, then shake them out.", focus: "hands" },
    { icon: "🖐️", text: "Stretch your fingers wide, hold for five seconds, release.", focus: "hands" },
    { icon: "🖐️", text: "Circle each wrist slowly, five times in each direction.", focus: "hands" },
  ],
  breathing: [
    { icon: "🌬️", text: "Four counts in, six counts out. Three rounds.", focus: "breathing" },
    { icon: "🌬️", text: "One slow breath all the way out before you read the next line.", focus: "breathing" },
    { icon: "🌬️", text: "Breathe in through your nose, out through your mouth, twice.", focus: "breathing" },
  ],
};

/**
 * Which focus areas a card covers, by band. The first three mirror the
 * documented eyes -> posture -> water escalation; the longer bands add one
 * movement-style step because by then sitting still is the problem.
 */
const PLAN: Record<StretchBand, Focus[]> = {
  "eyes": ["eyes"],
  "eyes-posture": ["eyes", "posture"],
  "eyes-posture-water": ["eyes", "posture", "water"],
  "eyes-posture-water-day": ["eyes", "posture", "water", "movement"],
};

/**
 * Extra focus areas mixed in as the rotation advances, so a long day doesn't
 * replay the same three steps. Indexed by how many cards have been shown.
 */
const VARIETY: Focus[] = ["movement", "hands", "breathing"];

/** Upper bound on steps per card, so it stays glanceable. */
export const MAX_STEPS = 4;

/**
 * Pick the exercises for one card.
 *
 * Selection is deterministic given its inputs — the same stretch and rotation
 * always produce the same card — which is what makes it testable and what lets
 * the UI stay predictable.
 *
 * @precondition `stretchSeconds >= 0`, `rotation >= 0`.
 * @param stretchSeconds - Continuous active time since the last break.
 * @param rotation - How many cards have been shown already (any non-negative
 *   integer); advancing it rotates the phrasing.
 * @returns One exercise per focus area for this band, in display order.
 */
export const selectExercises = (
  stretchSeconds: number,
  rotation: number,
): Exercise[] => {
  const band = bandForStretch(stretchSeconds);
  const focuses = [...PLAN[band]];

  // On the two longer bands, swap in a rotating extra so repeat cards differ
  // by more than wording alone.
  if (band === "eyes-posture-water" || band === "eyes-posture-water-day") {
    const extra = VARIETY[rotation % VARIETY.length];
    if (!focuses.includes(extra)) focuses.push(extra);
  }

  // Four steps is the most a glanceable card can carry without becoming a
  // chore to read — which would defeat the point.
  return focuses.slice(0, MAX_STEPS).map((focus) => {
    const variants = POOL[focus];
    // Straight rotation, so rotation 0 is the documented first-run wording.
    // The pools are different lengths, so they drift apart on their own.
    return variants[rotation % variants.length];
  });
};

/** Every exercise in the library, for tests and for the generator's prompt. */
export const allExercises = (): Exercise[] => Object.values(POOL).flat();
