/**
 * Optional Claude-generated recovery suggestions.
 *
 * This module is strictly additive. The app is fully functional without it:
 * if there is no API key, no network, or any error at all, the caller keeps
 * the built-in library from `exercises.ts` and the user never sees a failure.
 *
 * What leaves the machine when this is enabled: three integers — minutes in
 * the current stretch, minutes active today, and the hour of day — plus the
 * wording of the last few cards so the model can avoid repeating itself. No
 * screen contents, no window titles, no keystrokes, no file paths. The idle
 * signal itself never leaves; only the minute counts derived from it do.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Exercise, Focus } from "./exercises";

/**
 * The model used for suggestions. Override with ANTI_BURNOUT_MODEL if you
 * want a cheaper tier — the card is four short sentences, so a smaller model
 * is a perfectly reasonable choice here.
 */
const MODEL = process.env.ANTI_BURNOUT_MODEL || "claude-opus-5-5";

/** Shape the model must return. Kept small and strict on purpose. */
const SuggestionSchema = z.object({
  steps: z
    .array(
      z.object({
        icon: z.string().describe("Exactly one emoji character."),
        text: z
          .string()
          .describe(
            "One imperative sentence, at most 90 characters, describing a " +
              "physical recovery action doable at a desk in under a minute.",
          ),
        focus: z
          .enum(["eyes", "posture", "water", "movement", "hands", "breathing"])
          .describe("Which recovery area this step addresses."),
      }),
    )
    .describe("Between 1 and 4 steps, ordered most urgent first."),
  footnote: z
    .string()
    .describe(
      "A short closing line, or an empty string for none. Never suggests work.",
    ),
});

export type Suggestion = {
  steps: Exercise[];
  footnote?: string;
};

export interface SuggestInput {
  /** Minutes in the current continuous stretch. */
  stretchMinutes: number;
  /** Minutes active today in total. */
  todayMinutes: number;
  /** Local hour, 0-23, so late-evening cards can read differently. */
  hourOfDay: number;
  /** Wording of recent cards, so the model varies from them. */
  recentTexts: string[];
}

const SYSTEM = [
  "You write a single recovery card for someone who has been at a computer too long.",
  "The person is at risk of burnout from work compressing into every hour of the day.",
  "",
  "Rules, all of them hard:",
  "- Suggest only physical recovery: eyes, posture, water, gentle movement, hands, breathing.",
  "- Never suggest work, planning, reviewing, journalling, or anything productive.",
  "- Never ask a question, set a goal, or request a reply. This is not a conversation.",
  "- Each step must be doable in under a minute, at or beside a desk, with no equipment.",
  "- Escalate with the stretch: longer at the screen means more of the body needs attention.",
  "- After 3 hours, or late in the evening, it is reasonable to say the day could end.",
  "- Be calm and plain. No exclamation marks, no cheerleading, no emoji in the text field.",
].join("\n");

/**
 * Build the per-request prompt. Deliberately all-numeric so the cached system
 * prefix above stays byte-stable across calls.
 */
const buildPrompt = (input: SuggestInput): string => {
  const lines = [
    `Minutes at the screen in this unbroken stretch: ${input.stretchMinutes}`,
    `Minutes active in total today: ${input.todayMinutes}`,
    `Local hour (0-23): ${input.hourOfDay}`,
  ];
  if (input.recentTexts.length > 0) {
    lines.push("", "Recent cards — say something different:");
    for (const t of input.recentTexts) lines.push(`- ${t}`);
  }
  return lines.join("\n");
};

/** Reject anything that would look wrong in the card. */
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Ask Claude for one card's worth of exercises.
 *
 * @param input - Coarse counters describing the current stretch.
 * @param signal - Abort signal, so a slow call can be dropped.
 * @returns A suggestion, or `null` on any failure whatsoever — missing key,
 *   offline, rate limited, malformed response. The caller falls back.
 */
export const generateSuggestion = async (
  input: SuggestInput,
  signal?: AbortSignal,
): Promise<Suggestion | null> => {
  try {
    // Ten seconds is generous for a four-sentence card and keeps a hung
    // request from occupying the prefetch slot.
    const client = new Anthropic({ timeout: 10_000, maxRetries: 1 });

    const response = await client.messages.parse(
      {
        model: MODEL,
        max_tokens: 2048,
        // A deliberately short, repeated, low-stakes generation: low effort
        // keeps it cheap and fast without hurting four sentences of output.
        output_config: {
          effort: "low",
          format: zodOutputFormat(SuggestionSchema),
        },
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: buildPrompt(input) }],
      },
      { signal },
    );

    if (response.stop_reason === "refusal") return null;

    const parsed = response.parsed_output;
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return null;
    }

    const steps: Exercise[] = parsed.steps.slice(0, 4).map((s) => ({
      icon: clean(s.icon).slice(0, 4) || "•",
      text: clean(s.text).slice(0, 120),
      focus: s.focus as Focus,
    }));
    if (steps.some((s) => s.text.length === 0)) return null;

    const footnote = clean(parsed.footnote ?? "");
    return { steps, footnote: footnote.length > 0 ? footnote : undefined };
  } catch {
    // Every failure mode lands here on purpose. A recovery card is not worth
    // surfacing an error over — the built-in library is already good enough.
    return null;
  }
};

/**
 * Whether an API key is visible in the environment.
 *
 * Informational only — do NOT gate calls on this. The SDK resolves credentials
 * from several places (env vars, but also a logged-in profile on disk), so a
 * false here does not mean a call would fail. The only reliable test is to
 * make the call and see whether it returns null.
 */
export const hasApiKeyInEnv = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
