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
  parent_id: string | null;
  path: string;
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
  parent_id?: string | null;
}

export interface QuestionPayload {
  stem: string;
  type: QuestionType;
  options: Option[];
  correct: string[];
  knowledge_summary?: string | null;
  tag_ids: string[];
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

/** parentId === null => make it a root tag (backend PUT /tags/{id}/move). */
export function moveTag(id: string, parentId: string | null): Promise<Tag> {
  return apiFetch<Tag>(`/tags/${id}/move`, {
    method: "PUT",
    body: { parent_id: parentId },
  });
}

export async function deleteTag(id: string): Promise<void> {
  await apiFetch(`/tags/${id}`, { method: "DELETE" });
}

// --- Questions ---

export interface ListQuestionsParams {
  limit?: number;
  offset?: number;
  tagId?: string | null;
  q?: string | null;
}

export function listQuestions(
  params: ListQuestionsParams = {},
): Promise<QuestionListOut> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.tagId) qs.set("tag_id", params.tagId);
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
