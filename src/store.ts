/**
 * Tiny JSON persistence for config and tracker state.
 *
 * Deliberately dependency-free (just `fs`) so it stays trivial and testable.
 * Only coarse counters are ever written — never anything about screen content.
 */
import * as fs from "fs";
import * as path from "path";
import { TrackerConfig, TrackerState, DEFAULT_CONFIG } from "./tracker";

export interface AppConfig extends TrackerConfig {
  /** Minutes a "Snooze" push the next reminder back by. */
  snoozeMinutes: number;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  ...DEFAULT_CONFIG,
  snoozeMinutes: 5,
};

/**
 * Read a JSON file, returning a fallback when it is missing or malformed.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param fallback - Value returned on any read/parse failure.
 * @returns The parsed object, or `fallback`.
 */
const readJson = <T>(filePath: string, fallback: T): T => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
};

/**
 * Write a value as pretty-printed JSON, creating the directory if needed.
 *
 * @param filePath - Absolute destination path.
 * @param value - The serialisable value to persist.
 */
const writeJson = (filePath: string, value: unknown): void => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  } catch {
    // Persistence is best-effort; losing a counter is not worth crashing over.
  }
};

export const loadConfig = (dir: string): AppConfig =>
  readJson(path.join(dir, "config.json"), DEFAULT_APP_CONFIG);

export const saveConfig = (dir: string, config: AppConfig): void =>
  writeJson(path.join(dir, "config.json"), config);

export const loadState = (
  dir: string,
  fallback: TrackerState,
): TrackerState => readJson(path.join(dir, "state.json"), fallback);

export const saveState = (dir: string, state: TrackerState): void =>
  writeJson(path.join(dir, "state.json"), state);

/**
 * Local calendar day as YYYY-MM-DD, used to roll the daily total at midnight.
 *
 * @param date - The instant to derive the day from (defaults to now).
 * @returns The local day string.
 */
export const dayKeyOf = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
