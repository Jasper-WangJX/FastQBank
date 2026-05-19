// Typed client for the stage-6 AI endpoints. Mirrors qbank.ts: thin
// wrappers over the shared transports (auth/401/ApiError live in api.ts).
// JSON tasks use apiFetch; parse-question is multipart -> apiFetchForm.

import { apiFetch, apiFetchForm } from "./api";
import type { Option, QuestionType } from "./qbank";

// --- Types mirroring the backend pydantic schemas ---

export interface SuggestedTag {
  id: string;
  name: string;
  path: string;
}

export interface SuggestTagsOut {
  tags: SuggestedTag[];
}

export interface KnowledgeSummaryOut {
  summary: string;
}

export interface ParseQuestionOut {
  stem: string;
  type: QuestionType;
  options: Option[];
  matched: boolean;
}

export interface GeneratedQuestion {
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  valid: boolean;
  validation_error: string | null;
  knowledge_summary: string;
  tags: string[];
}

export interface GenerateOut {
  questions: GeneratedQuestion[];
}

export interface AiUsageOut {
  total_tokens: number;
  request_count: number;
  limit: number;
}

// --- Text tasks (DeepSeek) ---

/** Top-3 tags chosen by the model from the user's OWN tags (resolved
 *  server-side to ids so the form can pre-select them). */
export function suggestTags(
  stem: string,
  options: Option[],
): Promise<SuggestTagsOut> {
  return apiFetch<SuggestTagsOut>("/ai/suggest-tags", {
    method: "POST",
    body: { stem, options },
  });
}

export function knowledgeSummary(
  stem: string,
  options: Option[],
): Promise<KnowledgeSummaryOut> {
  return apiFetch<KnowledgeSummaryOut>("/ai/knowledge-summary", {
    method: "POST",
    body: { stem, options },
  });
}

export function getAiUsage(): Promise<AiUsageOut> {
  return apiFetch<AiUsageOut>("/ai/usage");
}

/** Generate `count` new questions seeded by the picked question ids.
 *  Each draft carries its own existing-tag names + knowledge_summary. */
export function generate(
  seedQuestionIds: string[],
  count: number,
): Promise<GenerateOut> {
  return apiFetch<GenerateOut>("/ai/generate", {
    method: "POST",
    body: { seed_question_ids: seedQuestionIds, count },
  });
}

// --- Vision task (Gemini) ---

/** Decode a base64 PNG (carried from the desktop crop) into a Blob so
 *  it can ride a multipart form. */
function base64ToPngBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** On-demand OCR fallback: cropped screenshot + OCR text hint ->
 *  structured question with LaTeX recovered. */
export function parseQuestion(
  imageB64: string,
  ocrText: string,
): Promise<ParseQuestionOut> {
  const form = new FormData();
  form.append("image", base64ToPngBlob(imageB64), "crop.png");
  form.append("ocr_text", ocrText);
  return apiFetchForm<ParseQuestionOut>("/ai/parse-question", form);
}
