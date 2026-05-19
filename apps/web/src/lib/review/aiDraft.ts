// Pure, React-free helpers turning AI-generation drafts into ephemeral
// flashcards. Synthetic ids let the existing buildDeck / session logic
// reuse them unchanged; the `__ai` marker tells the session to skip
// ReviewLog / wrong-set and show "Add to question bank". The id
// generator is injected (default crypto.randomUUID) so tests are
// deterministic — mirrors the injected rng in session.ts.

import type { GeneratedQuestion } from "../ai";
import type { Question, Tag } from "../qbank";

/** A Question-shaped ephemeral card with no DB id. */
export interface AiCard extends Question {
  __ai: true;
}

export type MakeId = () => string;

/** Build a lower(trim(name)) -> Tag map; first occurrence wins (mirrors
 *  the backend `setdefault` in suggest_tags / generate). */
export function tagsByLowerName(tags: Tag[]): Map<string, Tag> {
  const m = new Map<string, Tag>();
  for (const t of tags) {
    const key = t.name.trim().toLowerCase();
    if (!m.has(key)) m.set(key, t);
  }
  return m;
}

/** Narrowing guard — the single source of truth for "is this an AI
 *  card?" used by the session page. */
export function isAiCard(q: Question): q is AiCard {
  return (q as Partial<AiCard>).__ai === true;
}

/** Keep only valid drafts; wrap each as a Question-shaped AiCard with a
 *  synthetic id, source "ai", resolved existing tags (case-insensitive,
 *  deduped, <=3, misses dropped) and the knowledge summary (empty ->
 *  null so the session hides the note row). Never creates a tag. */
export function buildAiCards(
  drafts: GeneratedQuestion[],
  tagsByName: Map<string, Tag>,
  makeId: MakeId = () => crypto.randomUUID(),
): AiCard[] {
  const out: AiCard[] = [];
  for (const d of drafts) {
    if (!d.valid) continue;
    const resolved: Tag[] = [];
    const seen = new Set<string>();
    for (const name of d.tags) {
      const key = name.trim().toLowerCase();
      const hit = tagsByName.get(key);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        resolved.push(hit);
      }
      if (resolved.length === 3) break;
    }
    out.push({
      id: makeId(),
      user_id: "",
      stem: d.stem,
      type: d.type,
      options: d.options,
      correct: d.correct,
      knowledge_summary: d.knowledge_summary
        ? d.knowledge_summary
        : null,
      source: "ai",
      created_at: "",
      updated_at: "",
      tags: resolved,
      __ai: true,
    });
  }
  return out;
}
