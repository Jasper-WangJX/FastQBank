// Pure, React-free logic for the flashcards review session. Kept out of
// the page components so it can be unit-tested in isolation (mirrors
// lib/ocr/splitter.ts). Randomness is always an injected rng so tests
// are deterministic.

import type { Option, Question } from "../qbank";

export type Rng = () => number;

/** Toggle one id in a selection set; returns a NEW set (immutable). */
export function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** True iff `ids` is non-empty and every id is in `set` (drives the
 *  global "Select all" vs "Deselect all" button label). */
export function allSelected(ids: string[], set: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id));
}

/** Order-independent exact-set comparison of picked labels vs correct. */
export function isAnswerCorrect(
  question: Question,
  selected: string[],
): boolean {
  if (selected.length === 0) return false;
  const a = new Set(selected);
  const b = new Set(question.correct);
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Fisher–Yates (descending) using an injected rng; returns a new array.
 *  j = i - floor(rng() * (i+1)) so that rng()->0 always picks j=i (no-op
 *  swap, preserving order) and rng()->1 always picks j=0 (extreme swap). */
export function shuffleWithRng<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = i - Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Random sample of `count` (all of them if count >= length). */
export function applyRandomCap<T>(items: T[], count: number, rng: Rng): T[] {
  if (count >= items.length) return items.slice();
  return shuffleWithRng(items, rng).slice(0, count);
}

export interface DeckCard {
  question: Question;
  /** Display order of options for THIS card (stable for the session). */
  options: Option[];
}

export interface BuildDeckOpts {
  /** True when "Random pick" was on (server already random-sampled, so
   *  order is already random — we keep it). False = selection order. */
  randomOrder: boolean;
  shuffleOptions: boolean;
  rng: Rng;
}

/** Turn the resolved questions into cards: fix each card's option order
 *  once (judge T/F is never shuffled — it must stay True,False). */
export function buildDeck(
  questions: Question[],
  opts: BuildDeckOpts,
): DeckCard[] {
  const ordered = opts.randomOrder
    ? shuffleWithRng(questions, opts.rng)
    : questions;
  return ordered.map((question) => ({
    question,
    options:
      opts.shuffleOptions && question.type !== "judge"
        ? shuffleWithRng(question.options, opts.rng)
        : question.options.slice(),
  }));
}
