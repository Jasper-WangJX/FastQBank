// Typed client for the stage-2 Tag / Question API. Thin wrappers over the
// shared apiFetch transport (auth header, ApiError, 401 handling live
// there) — this module only adds types and URL/query building.

import { apiFetch } from "./api";

// --- Types mirroring the backend pydantic schemas ---

export type QuestionType = "single" | "multi" | "judge";

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Option {
  label: string;
  content: string;
}

export interface Question {
  id: string;
  user_id: string;
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  knowledge_summary: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export interface QuestionListOut {
  items: Question[];
  total: number;
  limit: number;
  offset: number;
}

// --- Request payloads ---

export interface TagCreate {
  name: string;
}

export interface QuestionPayload {
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  knowledge_summary?: string | null;
  tag_ids: string[];
  // Defaults to "manual" server-side; OCR confirm sends "ocr"; the
  // phase-8 "Add to question bank" sends "ai". Ignored by the backend
  // on PUT (edit), so it's create-only in effect.
  source?: "manual" | "ocr" | "ai";
}

// --- Tags ---

export function listTags(): Promise<Tag[]> {
  return apiFetch<Tag[]>("/tags");
}

export function createTag(body: TagCreate): Promise<Tag> {
  return apiFetch<Tag>("/tags", { method: "POST", body });
}

export function renameTag(id: string, name: string): Promise<Tag> {
  return apiFetch<Tag>(`/tags/${id}`, { method: "PATCH", body: { name } });
}


export async function deleteTag(id: string): Promise<void> {
  await apiFetch(`/tags/${id}`, { method: "DELETE" });
}

// --- Questions ---

export interface ListQuestionsParams {
  limit?: number;
  offset?: number;
  /** Zero or more flat tag ids. Combined under tagMatch semantics. */
  tagIds?: string[];
  /** "all" (AND, default) | "any" (OR). Ignored when tagIds is empty. */
  tagMatch?: "all" | "any";
  q?: string | null;
}

export function listQuestions(
  params: ListQuestionsParams = {},
): Promise<QuestionListOut> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  // URLSearchParams supports appending the same key multiple times,
  // matching FastAPI's `tag_id: list[UUID] = Query(...)` shape.
  for (const id of params.tagIds ?? []) qs.append("tag_id", id);
  if (params.tagIds && params.tagIds.length > 0 && params.tagMatch) {
    qs.set("tag_match", params.tagMatch);
  }
  if (params.q) qs.set("q", params.q);
  const suffix = qs.toString();
  return apiFetch<QuestionListOut>(
    `/questions${suffix ? `?${suffix}` : ""}`,
  );
}

export function getQuestion(id: string): Promise<Question> {
  return apiFetch<Question>(`/questions/${id}`);
}

export function createQuestion(body: QuestionPayload): Promise<Question> {
  return apiFetch<Question>("/questions", { method: "POST", body });
}

export function updateQuestion(
  id: string,
  body: QuestionPayload,
): Promise<Question> {
  return apiFetch<Question>(`/questions/${id}`, { method: "PUT", body });
}

export async function deleteQuestion(id: string): Promise<void> {
  await apiFetch(`/questions/${id}`, { method: "DELETE" });
}

// --- Stage 9 — Share-link cross-account transfer + bulk operations ---

export interface SharedQuestion {
  source_id: string;
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  knowledge_summary: string | null;
  source: "manual" | "ocr" | "ai";
  tag_names: string[];
}

export interface SharePayload {
  version: 1;
  questions: SharedQuestion[];
}

export interface ShareCreateOut {
  token: string;
  share_url: string;
}

export interface SharePreviewOut {
  payload: SharePayload;
  created_at: string;
}

export interface ShareImportOut {
  imported: number;
  skipped: number;
  tags_created: number;
  tags_reused: number;
}

export interface MyShareRow {
  id: string;
  token: string;
  question_count: number;
  created_at: string;
}

export interface MyShareListOut {
  items: MyShareRow[];
}

export function createShare(
  questionIds: string[],
): Promise<ShareCreateOut> {
  return apiFetch<ShareCreateOut>("/shares", {
    method: "POST",
    body: { question_ids: questionIds },
  });
}

export function getSharePreview(token: string): Promise<SharePreviewOut> {
  return apiFetch<SharePreviewOut>(`/shares/${token}`);
}

export function importShare(token: string): Promise<ShareImportOut> {
  return apiFetch<ShareImportOut>(`/shares/${token}/import`, {
    method: "POST",
  });
}

export function listMyShares(): Promise<MyShareListOut> {
  return apiFetch<MyShareListOut>("/shares/me");
}

export async function revokeShare(id: string): Promise<void> {
  await apiFetch(`/shares/${id}`, { method: "DELETE" });
}

// --- Bulk operations ---

export interface BulkAddTagsOut {
  questions_updated: number;
  links_added: number;
}

export function bulkAddTags(
  questionIds: string[],
  tagIds: string[],
): Promise<BulkAddTagsOut> {
  return apiFetch<BulkAddTagsOut>("/questions/bulk-tags", {
    method: "POST",
    body: { question_ids: questionIds, tag_ids: tagIds },
  });
}
