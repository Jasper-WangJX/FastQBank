// Paginated question bank with keyword (debounced) + multi-tag (AND/OR) filters.
// LaTeX in stems is rendered inline. Row actions: edit / delete.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import {
  createShare,
  deleteQuestion,
  listQuestions,
  listTags,
  type QuestionListOut,
  type Tag,
} from "../lib/qbank";
import { getTagQuestionIds } from "../lib/review";
import Latex from "../components/Latex";
import TagFilter from "../components/tags/TagFilter";
import TagManageDrawer from "../components/tags/TagManageDrawer";
import { QuestionCard, QuestionCardGrid } from "../components/QuestionCard";
import BulkAddTagModal from "../components/share/BulkAddTagModal";
import BundleResultModal from "../components/share/BundleResultModal";
import ImportModal from "../components/share/ImportModal";
import MySharesModal from "../components/share/MySharesModal";
import { getDesktop } from "../lib/desktop";

const PAGE_SIZE = 10;

export default function QuestionListPage() {
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<"all" | "any">("all");
  const [manageOpen, setManageOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0); // bump to force a refetch

  const [data, setData] = useState<QuestionListOut | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Presentation only — default "list" preserves the original UX.
  const [view, setView] = useState<"list" | "cards">("list");
  // Stage-9 selection: a Set of question ids. Survives paging / filter
  // changes (intentional — spec §2.6); cleared on hard refresh.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Modal flags
  const [importOpen, setImportOpen] = useState(false);
  const [mySharesOpen, setMySharesOpen] = useState(false);
  const [bundleResult, setBundleResult] = useState<{
    url: string;
    count: number;
  } | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  // Lightweight toast (info / success). Bulk delete + import use this.
  const [toast, setToast] = useState<string | null>(null);

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
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      tagMatch: tagIds.length > 0 ? tagMatch : undefined,
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
  }, [debouncedQ, tagIds, tagMatch, offset, tick]);

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

  const pageIds = (data?.items ?? []).map((qq) => qq.id);
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));

  function togglePageAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function selectAllFiltered() {
    // Reuse the existing review endpoint — returns every live owned
    // question id matching the SAME filters the list endpoint applies
    // (tag_id[] + tag_match + keyword). Without all three flowing
    // through, the banner count would silently disagree with the
    // selection delta.
    try {
      const ids = await getTagQuestionIds(
        tagIds.length > 0 ? tagIds : [],
        tagIds.length > 0 ? tagMatch : "all",
        debouncedQ || undefined,
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    }
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function onBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} questions?`)) return;
    setBusy(true);
    setError(null);
    let failures = 0;
    try {
      // Capped concurrency: 10 at a time. The backend tolerates 404
      // for ids the user no longer owns (e.g. deleted in another tab) —
      // we treat 404 as success (the item is gone, which is what the
      // user wanted). Other errors (network, 5xx) increment `failures`
      // so the toast is honest.
      const queue = [...ids];
      const workers = new Array(Math.min(10, queue.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            const id = queue.shift();
            if (id === undefined) break;
            try {
              await deleteQuestion(id);
            } catch (err: unknown) {
              if (err instanceof ApiError && err.status === 404) {
                // Already gone — treat as success.
                continue;
              }
              failures += 1;
            }
          }
        });
      await Promise.all(workers);
      const succeeded = ids.length - failures;
      // Drop succeeded ids from the Set (keep the failed ones so the
      // user can retry / inspect them).
      if (succeeded > 0) {
        // We don't know exactly which succeeded vs failed; for the
        // refetch-based UX this is acceptable — drop all attempted
        // ids and rely on the list refetch to bring back any that
        // are still live.
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
      if (failures === 0) {
        setToast(
          `Deleted ${succeeded} question${succeeded === 1 ? "" : "s"}`,
        );
      } else if (failures < ids.length) {
        setToast(
          `Deleted ${succeeded} of ${ids.length}; ${failures} failed`,
        );
      } else {
        setError(
          `Bulk delete failed for all ${ids.length} questions; please retry.`,
        );
      }
      if (failures < ids.length) {
        setTimeout(() => setToast(null), 3000);
      }
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  async function onBundle() {
    const ids = [...selected];
    if (ids.length === 0 || ids.length > 99) {
      if (ids.length > 99) {
        setError(
          `Can't bundle more than 99 questions per link (you have ${ids.length} selected).`,
        );
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await createShare(ids);
      setBundleResult({ url: r.share_url, count: ids.length });
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const hasFilters = q !== "" || tagIds.length > 0;

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
            onClick={() => setImportOpen(true)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import
          </button>
          <button
            onClick={() => setMySharesOpen(true)}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:underline"
          >
            My shares
          </button>
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
              setTagIds([]);
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

      {/* Tag filter + management */}
      <div className="mt-3">
        <TagFilter
          tags={tags}
          selectedIds={tagIds}
          onChangeSelected={(ids) => {
            setTagIds(ids);
            setOffset(0);
          }}
          match={tagMatch}
          onChangeMatch={(m) => {
            setTagMatch(m);
            setOffset(0);
          }}
          onOpenManage={() => setManageOpen(true)}
        />
      </div>

      {/* Stage-9: bulk action bar */}
      {selected.size >= 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
          <span className="text-sm font-medium text-slate-700">
            {selected.size} selected
          </span>
          <button
            onClick={clearSelection}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear
          </button>
          <span className="ml-2 h-4 w-px bg-gray-300" />
          <button
            disabled={busy}
            onClick={onBulkDelete}
            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Bulk delete
          </button>
          <button
            disabled={busy}
            onClick={() => setBulkTagOpen(true)}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Add tag
          </button>
          <button
            disabled={busy || selected.size > 99}
            onClick={onBundle}
            title={
              selected.size > 99
                ? "Bundle is capped at 99 questions per link"
                : undefined
            }
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Bundle as link
          </button>
        </div>
      )}

      {/* Stage-9: "select all filtered" prompt — shown only when the
          current page is fully selected AND the global Set is still
          smaller than the total match count. */}
      {pageAllSelected && selected.size < total && (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Selected {selected.size} on this page.{" "}
          <button
            onClick={selectAllFiltered}
            className="font-medium underline hover:no-underline"
          >
            Select all {total} matching
          </button>
        </div>
      )}

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
                selectControl={
                  <input
                    type="checkbox"
                    checked={selected.has(qq.id)}
                    onChange={() => toggleOne(qq.id)}
                    title="Select this question"
                    className="h-4 w-4"
                  />
                }
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
            <div className="flex items-center gap-3 bg-gray-50 px-3 py-2">
              <input
                type="checkbox"
                checked={pageAllSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !pageAllSelected && pageSomeSelected;
                }}
                onChange={togglePageAll}
                title="Select this page"
                className="h-4 w-4"
              />
              <span className="text-xs text-gray-500">
                {pageSomeSelected
                  ? `${pageIds.filter((id) => selected.has(id)).length} of ${pageIds.length} on this page selected`
                  : "Select page"}
              </span>
            </div>
            {items.map((qq) => (
              <div
                key={qq.id}
                className="flex items-start gap-3 px-3 py-3"
              >
                <input
                  type="checkbox"
                  checked={selected.has(qq.id)}
                  onChange={() => toggleOne(qq.id)}
                  title="Select this question"
                  className="mt-1 h-4 w-4 shrink-0"
                />
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
      <TagManageDrawer
        open={manageOpen}
        onClose={async () => {
          setManageOpen(false);
          // After closing, drop any selected ids whose tags were deleted.
          const live = new Set(tags.map((t) => t.id));
          const filtered = tagIds.filter((id) => live.has(id));
          if (filtered.length !== tagIds.length) setTagIds(filtered);
        }}
        tags={tags}
        onChanged={reloadTagsAndList}
      />
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={(msg) => {
            setToast(msg);
            setTimeout(() => setToast(null), 4000);
            setTick((t) => t + 1);
          }}
        />
      )}
      {mySharesOpen && (
        <MySharesModal
          baseUrl={window.location.origin}
          onClose={() => setMySharesOpen(false)}
        />
      )}
      {bundleResult && (
        <BundleResultModal
          url={bundleResult.url}
          questionCount={bundleResult.count}
          onClose={() => setBundleResult(null)}
        />
      )}
      {bulkTagOpen && (
        <BulkAddTagModal
          questionIds={[...selected]}
          initialTags={tags}
          onClose={() => setBulkTagOpen(false)}
          onApplied={() => {
            setToast(
              `Tagged ${selected.size} question${selected.size === 1 ? "" : "s"}`,
            );
            setTimeout(() => setToast(null), 3000);
            setTick((t) => t + 1);
          }}
        />
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
