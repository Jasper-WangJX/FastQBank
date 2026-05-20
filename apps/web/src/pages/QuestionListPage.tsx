// Paginated question bank with keyword (debounced) + multi-tag (AND/OR) filters.
// LaTeX in stems is rendered inline. Row actions: edit / delete.
//
// Visual language: "Sapphire Console" (Variant E) — sharp 2px corners, mono
// metadata, sapphire accent. Behavior is preserved from the previous layout;
// only the visual layer changed.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Link2,
  List,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
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

// Map QuestionListItem.type ("single" | "multi" | "judge") to a short
// uppercase mono badge label. Strings are pure presentation — the underlying
// type value is left untouched.
function typeBadge(t: string): string {
  if (t === "single") return "MCQ";
  if (t === "multi") return "MULTI";
  if (t === "judge") return "T/F";
  return t.toUpperCase();
}

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
  const pages = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE);
  const currentPage = total === 0 ? 1 : Math.floor(offset / PAGE_SIZE) + 1;

  // Sapphire-tinted accent for native checkboxes.
  const checkboxClass =
    "h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#1E3A8A]";
  // Shared ghost-button shell for header / pagination / bulk-bar buttons.
  const ghostBtn =
    "inline-flex h-8 items-center gap-1.5 rounded-sm border border-slate-200 px-2.5 text-xs text-slate-700 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div className="rounded-sm border border-slate-200 bg-white p-5">
      {/* Page-local keyframes: blinking caret + row fade-in stagger. */}
      <style>{`
        @keyframes fqb-blink-q {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes fqb-fadein {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fqb-caret { animation: fqb-blink-q 1.05s steps(2, end) infinite; }
        .fqb-row   { animation: fqb-fadein 220ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .fqb-caret, .fqb-row { animation: none !important; }
        }
      `}</style>

      {/* ====================================================================
          Title row
          ==================================================================== */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500">
            MODULE / QUESTION-BANK
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            Question bank
          </h1>
          <div className="mt-1 font-mono text-[11.5px] text-slate-500">
            &gt; {total} records indexed · {selected.size} selected
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {getDesktop() && (
            <button
              type="button"
              onClick={() => getDesktop()?.ocr.trigger()}
              title="Screenshot a question on screen and import it via OCR"
              className={ghostBtn}
            >
              <Camera size={14} strokeWidth={1.5} />
              <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                OCR
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            title="Import questions from file"
            className={ghostBtn}
          >
            <Upload size={14} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              IMPORT
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMySharesOpen(true)}
            title="My shares"
            className={ghostBtn}
          >
            <Link2 size={14} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              SHARES
            </span>
          </button>

          {/* Primary CTA */}
          <button
            type="button"
            onClick={() => navigate("/questions/new")}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 text-xs font-medium text-white transition-colors duration-150 hover:bg-[#2563EB]"
          >
            <Plus size={14} strokeWidth={1.5} />
            <span className="font-mono uppercase tracking-[0.08em]">
              NEW QUESTION
            </span>
            <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-sm border border-white/40 bg-white/10 px-1 font-mono text-[10px] leading-none text-white">
              N
            </span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          Filter "command line"
          ==================================================================== */}
      <div className="mt-5 flex flex-wrap items-stretch gap-2">
        {/* Search input — sharp-cornered, leading ›, blinking caret. */}
        <label
          htmlFor="qb-search"
          className="group flex h-9 min-w-[280px] flex-1 items-center gap-2 rounded-sm border border-slate-200 bg-white px-2.5 transition-colors duration-150 focus-within:border-[#1E3A8A] hover:border-[#2563EB]"
        >
          <span className="font-mono text-[13px] font-medium text-[#0B3B8C] select-none">
            ›
          </span>
          <span
            aria-hidden
            className="fqb-caret inline-block h-[14px] w-[6px] shrink-0"
            style={{ backgroundColor: "#60A5FA" }}
          />
          <input
            id="qb-search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder="Search stem…"
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12.5px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          {q !== "" && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setOffset(0);
              }}
              title="Clear search"
              aria-label="Clear search"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-400 transition-colors duration-150 hover:text-[#1E3A8A]"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
          <Search
            size={12}
            strokeWidth={1.5}
            className="text-slate-400 group-focus-within:text-[#1E3A8A]"
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setTagIds([]);
              setOffset(0);
            }}
            className={ghostBtn}
          >
            <X size={12} strokeWidth={1.5} />
            <span className="font-mono uppercase tracking-[0.08em] text-[11px]">
              CLEAR FILTERS
            </span>
          </button>
        )}

        {/* View toggle — single hairline shell, two icon buttons. */}
        <div className="ml-auto flex items-stretch rounded-sm border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label="List view"
            title="List view"
            className={
              "flex h-[34px] w-9 items-center justify-center transition-colors duration-150 " +
              (view === "list"
                ? "bg-[#1E3A8A] text-white"
                : "text-slate-500 hover:text-[#1E3A8A]")
            }
          >
            <List size={14} strokeWidth={1.5} />
          </button>
          <div className="w-px self-stretch bg-slate-200" />
          <button
            type="button"
            onClick={() => setView("cards")}
            aria-label="Card view"
            title="Card view"
            className={
              "flex h-[34px] w-9 items-center justify-center transition-colors duration-150 " +
              (view === "cards"
                ? "bg-[#1E3A8A] text-white"
                : "text-slate-500 hover:text-[#1E3A8A]")
            }
          >
            <LayoutGrid size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ====================================================================
          Tag filter + management
          ==================================================================== */}
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

      {/* ====================================================================
          Bulk action bar
          ==================================================================== */}
      {selected.size >= 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2">
          <span className="font-mono text-[11.5px] font-semibold text-[#1E3A8A]">
            [ {selected.size} SELECTED ]
          </span>
          <span className="mx-1 h-4 w-px bg-[#DBEAFE]" />

          <button
            type="button"
            disabled={busy}
            onClick={onBulkDelete}
            title="Bulk delete"
            className="group inline-flex h-7 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[11px] text-slate-700 transition-colors duration-150 hover:border-[#DC2626] hover:text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              DELETE
            </span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => setBulkTagOpen(true)}
            title="Add tag"
            className="group inline-flex h-7 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[11px] text-slate-700 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TagIcon size={12} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              ADD TAG
            </span>
          </button>

          <button
            type="button"
            disabled={busy || selected.size > 99}
            onClick={onBundle}
            title={
              selected.size > 99
                ? "Bundle is capped at 99 questions per link"
                : "Bundle as link"
            }
            className="group inline-flex h-7 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[11px] text-slate-700 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 size={12} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              BUNDLE
            </span>
          </button>

          <button
            type="button"
            onClick={clearSelection}
            title="Clear selection"
            className="group inline-flex h-7 items-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[11px] text-slate-700 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A]"
          >
            <X size={12} strokeWidth={1.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
              CLEAR
            </span>
          </button>
        </div>
      )}

      {/* ====================================================================
          "Select all filtered" prompt
          ==================================================================== */}
      {pageAllSelected && selected.size < total && (
        <div className="mt-2 rounded-sm border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2 font-mono text-[11.5px] text-[#1E3A8A]">
          Selected {selected.size} on this page.{" "}
          <button
            type="button"
            onClick={selectAllFiltered}
            className="font-semibold text-[#1E3A8A] underline underline-offset-2 hover:no-underline"
          >
            Select all {total} matching
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          [ ERR ] {error}
        </div>
      )}

      {/* ====================================================================
          List / Cards body
          ==================================================================== */}
      <div className="mt-5">
        {data === null ? (
          <p className="font-mono text-xs text-slate-500">
            &gt; awaiting response
            <span
              aria-hidden
              className="fqb-caret ml-1 inline-block h-[12px] w-[6px] align-middle"
              style={{ backgroundColor: "#60A5FA" }}
            />
          </p>
        ) : items.length === 0 ? (
          <p className="font-mono text-xs text-slate-500">
            {hasFilters
              ? "> no questions match these filters."
              : "> no questions yet. press N to create the first one."}
          </p>
        ) : view === "cards" ? (
          <>
            {/* Page-level select-all strip — parity with the list view's
                header row, just rendered above the grid. */}
            <div
              className="mb-3 flex items-center gap-2 rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-slate-500"
            >
              <input
                type="checkbox"
                checked={pageAllSelected}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      !pageAllSelected && pageSomeSelected;
                }}
                onChange={togglePageAll}
                title="Select this page"
                aria-label="Select this page"
                className={checkboxClass}
              />
              <span>
                {pageSomeSelected
                  ? `${pageIds.filter((id) => selected.has(id)).length} of ${pageIds.length} on this page`
                  : "Select page"}
              </span>
            </div>
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
                      className={checkboxClass}
                    />
                  }
                  actions={
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => navigate(`/questions/${qq.id}/edit`)}
                        title="Edit"
                        aria-label="Edit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil size={12} strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(qq.id, qq.stem)}
                        title="Delete"
                        aria-label="Delete"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:border-[#DC2626] hover:text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </>
                  }
                />
              ))}
            </QuestionCardGrid>
          </>
        ) : (
          <div className="overflow-hidden rounded-sm border border-slate-200">
            {/* Header row. IDX / ID / UPDATED have been dropped — they
                added no signal for the user and ate horizontal space
                that's better spent on the stem. The freed space goes
                to STEM; TYPE + TAGS shift right. */}
            <div
              className="grid items-center gap-x-8 border-b border-slate-200 bg-slate-50 px-3 py-2 font-mono uppercase tracking-[0.12em] text-[10px] text-slate-500"
              style={{
                gridTemplateColumns:
                  "24px minmax(0, 1fr) 60px 200px 60px",
              }}
            >
              <span className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={pageAllSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        !pageAllSelected && pageSomeSelected;
                  }}
                  onChange={togglePageAll}
                  title="Select this page"
                  aria-label="Select this page"
                  className={checkboxClass}
                />
              </span>
              <span>STEM</span>
              <span>TYPE</span>
              <span>TAGS</span>
              <span className="text-right">ACTIONS</span>
            </div>

            <ul className="divide-y divide-slate-100">
              {items.map((qq, i) => {
                const visibleTags = qq.tags.slice(0, 2);
                const overflow = qq.tags.length - visibleTags.length;
                return (
                  <li
                    key={qq.id}
                    className="fqb-row group relative grid items-center gap-x-8 px-3 py-2.5 transition-colors duration-150 hover:bg-[#EFF6FF] before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[#1E3A8A] before:opacity-0 group-hover:before:opacity-100"
                    style={{
                      gridTemplateColumns:
                        "24px minmax(0, 1fr) 60px 200px 60px",
                      animationDelay: `${i * 10}ms`,
                    }}
                  >
                    {/* Decorative hover bar — uses a sibling span so that
                        Tailwind's `group-hover:before:opacity-100` actually
                        applies (the `before:` on the <li> is the same
                        element that hovers — left as belt-and-braces). */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-[#1E3A8A] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    />

                    {/* Checkbox */}
                    <span className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selected.has(qq.id)}
                        onChange={() => toggleOne(qq.id)}
                        title="Select this question"
                        aria-label="Select this question"
                        className={checkboxClass}
                      />
                    </span>

                    {/* Stem */}
                    <Latex
                      text={qq.stem}
                      className="line-clamp-1 min-w-0 text-sm text-slate-800"
                    />

                    {/* Type chip */}
                    <span>
                      <span className="inline-flex h-[20px] items-center rounded-sm border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10.5px] uppercase tracking-tight text-slate-600">
                        {typeBadge(qq.type)}
                      </span>
                    </span>

                    {/* Tags */}
                    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                      {visibleTags.map((t) => (
                        <span
                          key={t.id}
                          className="inline-flex h-[20px] max-w-[80px] items-center truncate rounded-sm border border-[#0B3B8C]/15 bg-[#DBEAFE] px-1.5 font-mono text-[10.5px] tracking-tight text-[#0B3B8C]"
                          title={t.name}
                        >
                          {t.name}
                        </span>
                      ))}
                      {overflow > 0 && (
                        <span className="font-mono text-[10.5px] text-slate-400">
                          +{overflow}
                        </span>
                      )}
                    </span>

                    {/* Actions */}
                    <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => navigate(`/questions/${qq.id}/edit`)}
                        title="Edit"
                        aria-label="Edit"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil size={12} strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(qq.id, qq.stem)}
                        title="Delete"
                        aria-label="Delete"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:border-[#DC2626] hover:text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ====================================================================
          Pagination
          ==================================================================== */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11.5px] text-slate-500">
          PAGE {currentPage}/{pages} — {from}..{to} of {total}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            aria-label="Previous page"
            title="Previous page"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 text-slate-600 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            aria-label="Next page"
            title="Next page"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 text-slate-600 transition-colors duration-150 hover:border-[#1E3A8A] hover:text-[#1E3A8A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronRight size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ====================================================================
          Modals (unchanged behavior)
          ==================================================================== */}
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

      {/* Toast — sharp 2px corners, sapphire-active background, mono.
          `bottom-10` keeps it clear of the 28px sticky status footer. */}
      {toast && (
        <div className="fixed bottom-10 right-6 z-50 rounded-sm border border-[#1E40AF] bg-[#1E3A8A] px-3 py-2 font-mono text-xs text-white shadow-lg">
          [ OK ] {toast}
        </div>
      )}
    </div>
  );
}
