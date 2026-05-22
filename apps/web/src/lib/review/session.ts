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

/** Order-independent exact-set comparison of picked labels vs a correct
 *  label list. Use this with a DeckCard's `correct` (which is expressed in
 *  the card's possibly re-labeled option space). */
export function isSelectionCorrect(
  correct: string[],
  selected: string[],
): boolean {
  if (selected.length === 0) return false;
  const a = new Set(selected);
  const b = new Set(correct);
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Order-independent exact-set comparison of picked labels vs a question's
 *  canonical correct labels. */
export function isAnswerCorrect(
  question: Question,
  selected: string[],
): boolean {
  return isSelectionCorrect(question.correct, selected);
}

/** Sequential display label by position: 0->A, 1->B, 2->C … */
function seqLabel(i: number): string {
  return String.fromCharCode(65 + i);
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
  /** Display order of options for THIS card (stable for the session).
   *  When shuffled, only the *content* moves: labels are re-assigned
   *  sequentially (A, B, C…) by display position, so the letters down
   *  the list always read in order. */
  options: Option[];
  /** Correct labels in terms of THIS card's (possibly re-labeled)
   *  options. Judge / unshuffled cards reuse the question's canonical
   *  labels; shuffled cards carry the relabeled positions. Always use
   *  this — never question.correct — when judging picks for the card. */
  correct: string[];
}

export interface BuildDeckOpts {
  /** True when "Random pick" was on (server already random-sampled, so
   *  order is already random — we keep it). False = selection order. */
  randomOrder: boolean;
  shuffleOptions: boolean;
  rng: Rng;
}

/** Turn the resolved questions into cards: fix each card's option order
 *  once (judge T/F is never shuffled — it must stay True,False). When a
 *  card's options ARE shuffled, the labels are re-assigned A,B,C… by
 *  display position so only the content moves; `correct` is remapped to
 *  the new labels accordingly. */
export function buildDeck(
  questions: Question[],
  opts: BuildDeckOpts,
): DeckCard[] {
  const ordered = opts.randomOrder
    ? shuffleWithRng(questions, opts.rng)
    : questions;
  return ordered.map((question) => {
    const shuffle = opts.shuffleOptions && question.type !== "judge";
    if (!shuffle) {
      return {
        question,
        options: question.options.slice(),
        correct: question.correct.slice(),
      };
    }
    const correctOrig = new Set(question.correct);
    const shuffled = shuffleWithRng(question.options, opts.rng);
    // Re-label by display position: content moves, letters stay A,B,C…
    const options = shuffled.map((o, i) => ({
      label: seqLabel(i),
      content: o.content,
    }));
    const correct = shuffled
      .map((o, i) => (correctOrig.has(o.label) ? seqLabel(i) : null))
      .filter((l): l is string => l !== null);
    return { question, options, correct };
  });
}
