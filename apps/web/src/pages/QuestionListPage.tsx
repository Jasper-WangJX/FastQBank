// Paginated question bank with keyword (debounced) + tag-subtree filters.
// LaTeX in stems is rendered inline. Row actions: edit / delete.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import {
  deleteQuestion,
  listQuestions,
  listTags,
  type QuestionListOut,
  type Tag,
} from "../lib/qbank";
import Latex from "../components/Latex";
import TagManagePanel from "../components/tags/TagManagePanel";
import { QuestionCard, QuestionCardGrid } from "../components/QuestionCard";
import { getDesktop } from "../lib/desktop";

const PAGE_SIZE = 10;

export default function QuestionListPage() {
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tagId, setTagId] = useState("");
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0); // bump to force a refetch

  const [data, setData] = useState<QuestionListOut | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Presentation only — default "list" preserves the original UX.
  const [view, setView] = useState<"list" | "cards">("list");

  // Tag list for the filter dropdown (loaded once).
  useEffect(() => {
    let cancelled = false;
    listTags()
      .then((t) => {
        if (!cancelled) setTags(t);
      })
      .catch(() => {
        /* a tag-load failure shouldn't block browsing questions */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the keyword (no extra lib): commit `q` -> `debouncedQ`.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Single source of fetching: any of the four inputs triggers it.
  useEffect(() => {
    let cancelled = false;
    listQuestions({
      limit: PAGE_SIZE,
      offset,
      q: debouncedQ || null,
      tagId: tagId || null,
    })
      .then((res) => {
        if (cancelled) return;
        // If a delete/filter left us past the last page, step back
        // (this state change re-runs the effect).
        if (res.items.length === 0 && offset > 0 && res.total > 0) {
          setOffset((o) => Math.max(0, o - PAGE_SIZE));
          return;
        }
        setData(res);
        setError(null); // clear any stale error once fresh data loads
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Network error",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, tagId, offset, tick]);

  async function onDelete(id: string, stem: string) {
    if (!window.confirm(`Delete this question?\n\n${stem.slice(0, 80)}`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteQuestion(id);
      setTick((t) => t + 1); // refetch current page (effect handles
      // the "page now empty" step-back)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  // Re-fetch tags AND force the question list to reload. Called by the
  // tag panel's onChanged after a create/rename/move/delete (a deleted
  // tag changes which questions match). A plain async fn (not a
  // useEffect) so it's lint-safe under react-hooks/set-state-in-effect.
  async function reloadTagsAndList() {
    try {
      const t = await listTags();
      setTags(t);
    } catch {
      /* a tag reload failure shouldn't wipe the list */
    }
    setTick((x) => x + 1);
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const hasFilters = q !== "" || tagId !== "";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Question bank</h1>
        <div className="flex gap-2">
          {getDesktop() && (
            <button
              onClick={() => getDesktop()?.ocr.trigger()}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Screenshot a question on screen and import it via OCR"
            >
              OCR capture
            </button>
          )}
          <button
            onClick={() => navigate("/questions/new")}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + New question
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search stem…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        {hasFilters && (
          <button
            onClick={() => {
              setQ("");
              setTagId("");
              setOffset(0);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto flex overflow-hidden rounded-md border border-gray-300 text-sm">
          <button
            onClick={() => setView("list")}
            className={
              "px-3 py-2 " +
              (view === "list"
                ? "bg-slate-800 text-white"
                : "text-gray-600 hover:bg-gray-50")
            }
          >
            List
          </button>
          <button
            onClick={() => setView("cards")}
            className={
              "px-3 py-2 " +
              (view === "cards"
                ? "bg-slate-800 text-white"
                : "text-gray-600 hover:bg-gray-50")
            }
          >
            Cards
          </button>
        </div>
      </div>

      {/* Tag filter + management (Phase 7.1: tag CRUD lives here; the
          standalone /tags page was removed). */}
      <div className="mt-3">
        <TagManagePanel
          tags={tags}
          activeTagId={tagId || null}
          onSelect={(id) => {
            setTagId(id ?? "");
            setOffset(0);
          }}
          onChanged={reloadTagsAndList}
        />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      <div className="mt-5">
        {data === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">
            {hasFilters
              ? "No questions match these filters."
              : "No questions yet. Create your first one."}
          </p>
        ) : view === "cards" ? (
          <QuestionCardGrid>
            {items.map((qq) => (
              <QuestionCard
                key={qq.id}
                question={qq}
                actions={
                  <>
                    <button
                      disabled={busy}
                      onClick={() => navigate(`/questions/${qq.id}/edit`)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => onDelete(qq.id, qq.stem)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </>
                }
              />
            ))}
          </QuestionCardGrid>
        ) : (
          <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {items.map((qq) => (
              <div
                key={qq.id}
                className="flex items-start gap-3 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <Latex
                    text={qq.stem}
                    className="line-clamp-2 block text-sm text-gray-800"
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {qq.type}
                    </span>
                    {qq.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => navigate(`/questions/${qq.id}/edit`)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => onDelete(qq.id, qq.stem)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>
          {from}–{to} of {total}
        </span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
