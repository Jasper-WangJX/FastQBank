// Typed client for the stage-7 /review API. Thin wrappers over the
// shared apiFetch transport (auth header, ApiError, 401 handling live
// there). Question shapes are reused from qbank.ts.

import { apiFetch } from "./api";
import type { Question } from "./qbank";

export interface DeckOut {
  items: Question[];
}

export interface WrongListOut {
  items: Question[];
  total: number;
}

/** Resolve picked ids to live questions; `limit` = optional random cap. */
export function getDeck(
  questionIds: string[],
  limit?: number,
): Promise<DeckOut> {
  const body: { question_ids: string[]; limit?: number } = {
    question_ids: questionIds,
  };
  if (limit != null) body.limit = limit;
  return apiFetch<DeckOut>("/review/deck", { method: "POST", body });
}

/** Live question ids: a tag's subtree, or (no arg) ALL the user's. */
export function getTagQuestionIds(tagId?: string): Promise<string[]> {
  const qs = tagId ? `?tag_id=${encodeURIComponent(tagId)}` : "";
  return apiFetch<{ question_ids: string[] }>(
    `/review/tag-question-ids${qs}`,
  ).then((r) => r.question_ids);
}

/** Record one answered card. correct=false enters the wrong set. */
export async function postReviewLog(
  questionId: string,
  correct: boolean,
): Promise<void> {
  await apiFetch("/review/logs", {
    method: "POST",
    body: { question_id: questionId, correct },
  });
}

/** Active wrong questions + count. */
export function getWrongSet(): Promise<WrongListOut> {
  return apiFetch<WrongListOut>("/review/wrong");
}

/** Mark a question mastered (leaves the wrong set). */
export async function masterWrong(questionId: string): Promise<void> {
  await apiFetch(`/review/wrong/${questionId}/master`, { method: "POST" });
}
