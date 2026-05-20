// The review picker (spec §6.1). Selection is ONE global Set<questionId>
// that survives switching sources — a question stays selected wherever
// it appears (incl. multi-tagged). Sources: "All questions", "Wrong
// questions", or a multi-tag filter (AND/OR). "Select all" uses the
// dedicated id endpoint so it covers the whole active source, not
// just the loaded page. Selection is session-only (not persisted).
//
// Visual layer: Sapphire Console (Variant E). Behavior preserved 1:1.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  LayoutGrid,
  List,
} from "lucide-react";
import { ApiError } from "../lib/api";
import {
  listQuestions,
  listTags,
  type Question,
  type Tag,
} from "../lib/qbank";
import {
  getDeck,
  getTagQuestionIds,
  getWrongSet,
  masterWrong,
} from "../lib/review";
import { generate } from "../lib/ai";
import { buildAiCards, tagsByLowerName } from "../lib/review/aiDraft";
import {
  allSelected,
  shuffleWithRng,
  toggleId,
} from "../lib/review/session";
import Latex from "../components/Latex";
import { QuestionCard, QuestionCardGrid } from "../components/QuestionCard";
import TagFilter from "../components/tags/TagFilter";
import TagManageDrawer from "../components/tags/TagManageDrawer";

const PAGE_SIZE = 10;
const WRONG = "__wrong__"; // sentinel "tag" id for the wrong-set entry
const ALL = "__all__"; // sentinel: every question (no tag filter)

// Shared sapphire token tuples kept inline so this file is self-contained.
const MONO_FAMILY =
  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace";

export default function ReviewEntryPage() {
  const navigate = useNavigate();

  const [tags, setTags] = useState<Tag[]>([]);
  const [wrongTotal, setWrongTotal] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<"all" | "any">("all");
  const [manageOpen, setManageOpen] = useState(false);
  // Active list source: ALL (default) / WRONG / "" (tag-filter-driven).
  const [activeId, setActiveId] = useState<string>(ALL);
  // null = loading; [] = loaded but empty; Question[] = loaded results.
  const [items, setItems] = useState<Question[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  // The one global selection set.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Full id list of the active source (tag-filtered or wrong set) — drives
  // the global toggle label/action so it reflects the WHOLE source,
  // not just the loaded page.
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const [randomPick, setRandomPick] = useState(false);
  const [count, setCount] = useState(20);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [aiMode, setAiMode] = useState<"off" | "mixed" | "ai">("off");
  const [aiCount, setAiCount] = useState(5);

  // Bumped inside TagManageDrawer.onChanged so the active-list effect
  // re-runs and question rows reflect any tag renames immediately.
  const [tick, setTick] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Presentation only — default "list" preserves the original UX.
  const [view, setView] = useState<"list" | "cards">("list");

  // Derived: true when the user has selected tags and is not on All/Wrong.
  const tagFilterActive = activeId !== WRONG && activeId !== ALL && tagIds.length > 0;

  // Tag list + wrong count, once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([listTags(), getWrongSet()])
      .then(([t, w]) => {
        if (cancelled) return;
        setTags(t);
        setWrongTotal(w.total);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : "Network error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the active list (tag-filter, all questions, or the wrong set).
  // All setState calls are inside async callbacks (no synchronous setState
  // in the effect body) to satisfy react-hooks/set-state-in-effect.
  // items === null while loading; the UI shows "Loading…" in that state.
  useEffect(() => {
    if (!activeId && !tagFilterActive) {
      return;
    }
    let cancelled = false;
    const load =
      activeId === WRONG
        ? getWrongSet().then((w) => ({ items: w.items, total: w.total }))
        : listQuestions({
            tagIds: tagFilterActive ? tagIds : undefined,
            tagMatch: tagFilterActive ? tagMatch : undefined,
            limit: PAGE_SIZE,
            offset,
          }).then((r) => ({ items: r.items, total: r.total }));
    load
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
        setError(null);
        if (activeId === WRONG) setWrongTotal(r.total);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(e instanceof ApiError ? e.message : "Network error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, tagIds, tagMatch, offset, tagFilterActive, tick]);

  // Whole-source id set for the global Select-all/Deselect-all (covers
  // the entire source, independent of pagination).
  useEffect(() => {
    if (!activeId && !tagFilterActive) {
      return;
    }
    let cancelled = false;
    const load =
      activeId === WRONG
        ? getWrongSet().then((w) => w.items.map((q) => q.id))
        : getTagQuestionIds(
            tagFilterActive ? tagIds : [],
            tagFilterActive ? tagMatch : "all",
          );
    load
      .then((ids) => {
        if (!cancelled) setSourceIds(ids);
      })
      .catch(() => {
        if (!cancelled) setSourceIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, tagIds, tagMatch, tagFilterActive]);

  const everySelected = allSelected(sourceIds, selected);

  function pick(id: string) {
    setError(null);
    setActiveId(id);
    setOffset(0);
    setItems(null); // reset to loading state for the new source
  }

  function onToggleQuestion(id: string) {
    setSelected((s) => toggleId(s, id));
  }

  // Per-row master from the wrong-set listing (spec §2.2 — clearable
  // from the list as well as from a wrong-set card).
  async function onMasterRow(id: string) {
    setBusy(true);
    setError(null);
    try {
      await masterWrong(id);
      setItems((cur) => (cur ? cur.filter((x) => x.id !== id) : cur));
      setTotal((t) => Math.max(0, t - 1));
      setWrongTotal((t) => Math.max(0, t - 1));
      setSourceIds((ids) => ids.filter((x) => x !== id));
      setSelected((s) => {
        if (!s.has(id)) return s;
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  // "Select all" / "Deselect all" for the WHOLE active source (tag-filtered
  // or wrong set), not just the visible page.
  function onToggleAll() {
    if (sourceIds.length === 0) return;
    setSelected((s) => {
      const next = new Set(s);
      const addMode = !sourceIds.every((id) => next.has(id));
      for (const id of sourceIds) {
        if (addMode) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function onSubmit() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ids = [...selected];

      // --- Off: existing bank-only path, unchanged ---
      if (aiMode === "off") {
        const deck = await getDeck(ids, randomPick ? count : undefined);
        if (deck.items.length === 0) {
          setError("None of the selected questions are available anymore.");
          return;
        }
        navigate("/review/session", {
          state: {
            reviewConfig: {
              questions: deck.items,
              requestedOrder: ids,
              randomOrder: randomPick,
              shuffleOptions,
              fastMode,
              isWrongSetSession: activeId === WRONG,
            },
          },
        });
        return;
      }

      // --- Mixed / AI only: selected ids are the generation seeds ---
      const gen = await generate(ids, aiCount);
      const aiCards = buildAiCards(
        gen.questions,
        tagsByLowerName(tags),
      );

      // AiCard extends Question, so AiCard[] is assignable to Question[].
      let questions: Question[] = aiCards;
      let requestedOrder = aiCards.map((c) => c.id);
      let notice: string | undefined;

      if (aiMode === "ai") {
        if (aiCards.length === 0) {
          setError(
            "AI returned no usable questions. Try different seeds or try again.",
          );
          return;
        }
      } else {
        // mixed: selected bank questions + the AI cards
        const bank = await getDeck(ids, randomPick ? count : undefined);
        if (bank.items.length === 0 && aiCards.length === 0) {
          setError("None of the selected questions are available anymore.");
          return;
        }
        // Interleave bank + AI so they're mixed throughout the deck
        // (not all bank first then all AI). Shuffle once here and make
        // requestedOrder match, so the order holds whether or not
        // "Random pick" is on.
        questions = shuffleWithRng(
          [...bank.items, ...aiCards],
          Math.random,
        );
        requestedOrder = questions.map((q) => q.id);
        // Both-empty already errored above, so here at least one side
        // has cards — tell the user if the other side dropped out.
        if (bank.items.length === 0) {
          notice =
            "None of your selected bank questions are available; continuing with AI questions only.";
        } else if (aiCards.length === 0) {
          notice =
            "AI generation produced no usable questions; continuing with your selected questions.";
        }
      }

      navigate("/review/session", {
        state: {
          reviewConfig: {
            questions,
            requestedOrder,
            randomOrder: randomPick,
            shuffleOptions,
            fastMode,
            // AI modes never show the mastered button, even when the
            // seeds came from the wrong-set tab — by design (spec §5.2).
            isWrongSetSession: false,
            notice,
          },
        },
      });
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const showingPager = (activeId !== "" || tagFilterActive) && activeId !== WRONG;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  // Source eyebrow shown above the list.
  const sourceLabel =
    activeId === WRONG
      ? `WRONG QUESTIONS · ${total}`
      : activeId === ALL
        ? `ALL QUESTIONS · ${total}`
        : tagFilterActive
          ? `BY TAG FILTER · ${total}`
          : "SELECT A SOURCE";

  return (
    <div
      className="rounded-sm border-2 border-slate-200 bg-white p-6"
      style={{ fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes rep-rowin { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
        .rep-row { animation: rep-rowin 220ms ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .rep-row { animation: none !important; }
        }
      `}</style>

      {/* Eyebrow + title + mono subtitle */}
      <div
        className="font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500"
        style={{ fontFamily: MONO_FAMILY }}
      >
        MODULE / REVIEW
      </div>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[#0A2540]">
        Review
      </h1>
      <div
        className="mt-1 font-mono text-[11.5px] text-slate-600"
        style={{ fontFamily: MONO_FAMILY }}
      >
        &gt; {selected.size} selected · {wrongTotal} wrong
      </div>

      {error && (
        <div
          className="mt-4 rounded-sm border-2 border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700"
          style={{ fontFamily: MONO_FAMILY }}
        >
          [ ERROR ] · {error}
        </div>
      )}

      <div className="mt-4 flex gap-4">
        {/* Left rail: source picker + tag filter */}
        <div className="w-64 shrink-0 space-y-3">
          <div className="rounded-sm border-2 border-slate-200 bg-white p-2">
            <button
              onClick={() => {
                pick(WRONG);
                setTagIds([]);
              }}
              className={
                "block w-full rounded-sm px-2 py-1.5 text-left text-[12px] transition-colors duration-120 " +
                (activeId === WRONG
                  ? "bg-[#1E3A8A] text-white"
                  : "text-slate-700 hover:bg-[#EFF6FF]")
              }
              style={{ fontFamily: MONO_FAMILY }}
            >
              <span
                className={
                  activeId === WRONG ? "text-white/90" : "text-red-600"
                }
              >
                [ ! ]
              </span>{" "}
              <span
                className={
                  activeId === WRONG
                    ? "uppercase tracking-wider text-white"
                    : "uppercase tracking-wider text-slate-700"
                }
              >
                WRONG QUESTIONS
              </span>{" "}
              <span
                className={
                  activeId === WRONG ? "text-white/80" : "text-slate-500"
                }
              >
                ({wrongTotal})
              </span>
            </button>
            <button
              onClick={() => {
                pick(ALL);
                setTagIds([]);
              }}
              className={
                "mt-1 block w-full rounded-sm px-2 py-1.5 text-left text-[12px] uppercase tracking-wider transition-colors duration-120 " +
                (activeId === ALL && tagIds.length === 0
                  ? "bg-[#1E3A8A] text-white"
                  : "text-slate-700 hover:bg-[#EFF6FF]")
              }
              style={{ fontFamily: MONO_FAMILY }}
            >
              ALL QUESTIONS
            </button>
          </div>

          <TagFilter
            tags={tags}
            selectedIds={tagIds}
            onChangeSelected={(ids) => {
              setTagIds(ids);
              setOffset(0);
              // Selecting a tag implies leaving the All/Wrong fixed entries:
              // switch the active source to "by tag filter".
              if (ids.length > 0 && (activeId === WRONG || activeId === ALL)) {
                setActiveId(""); // sentinel for "tag-filter-driven"
                setItems(null);
              }
              // Removing the last chip while in tag-filter-driven mode falls back
              // to All so the user is never stuck with no source.
              if (ids.length === 0 && activeId === "") {
                setActiveId(ALL);
                setItems(null);
              }
            }}
            match={tagMatch}
            onChangeMatch={(m) => {
              setTagMatch(m);
              setOffset(0);
            }}
            onOpenManage={() => setManageOpen(true)}
          />
        </div>

        {/* Right pane: main list area */}
        <div className="min-w-0 flex-1 rounded-sm border-2 border-slate-200 bg-white">
          {activeId === "" && !tagFilterActive ? (
            <p
              className="p-4 font-mono text-[12px] text-slate-500"
              style={{ fontFamily: MONO_FAMILY }}
            >
              &gt; Select tags above (or choose All / Wrong questions) to start.
            </p>
          ) : (
            <>
              {/* Header row inside the pane */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <span
                  className="font-mono uppercase tracking-[0.18em] text-[10.5px] text-slate-500"
                  style={{ fontFamily: MONO_FAMILY }}
                >
                  {sourceLabel}
                </span>
                <div className="flex items-center gap-2">
                  {/* Segmented List / Cards toggle */}
                  <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-slate-200">
                    <button
                      onClick={() => setView("list")}
                      aria-label="List view"
                      title="List view"
                      className={
                        "flex h-7 w-8 items-center justify-center transition-colors duration-120 " +
                        (view === "list"
                          ? "bg-[#1E3A8A] text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0B3B8C]")
                      }
                    >
                      <List size={14} strokeWidth={1.5} />
                    </button>
                    <div className="w-px self-stretch bg-slate-200" />
                    <button
                      onClick={() => setView("cards")}
                      aria-label="Cards view"
                      title="Cards view"
                      className={
                        "flex h-7 w-8 items-center justify-center transition-colors duration-120 " +
                        (view === "cards"
                          ? "bg-[#1E3A8A] text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0B3B8C]")
                      }
                    >
                      <LayoutGrid size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                  <button
                    disabled={sourceIds.length === 0}
                    onClick={onToggleAll}
                    className="rounded-sm border border-slate-200 bg-white px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-slate-600 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                    style={{ fontFamily: MONO_FAMILY }}
                  >
                    {everySelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
              </div>

              <div className="p-3">
                {items === null ? (
                  <p
                    className="font-mono text-[12px] text-slate-500"
                    style={{ fontFamily: MONO_FAMILY }}
                  >
                    &gt; Loading…
                  </p>
                ) : items.length === 0 ? (
                  <p
                    className="font-mono text-[12px] text-slate-500"
                    style={{ fontFamily: MONO_FAMILY }}
                  >
                    &gt; No questions here.
                  </p>
                ) : view === "cards" ? (
                  <QuestionCardGrid>
                    {items.map((q) => {
                      const on = selected.has(q.id);
                      return (
                        <QuestionCard
                          key={q.id}
                          question={q}
                          actions={
                            <>
                              {activeId === WRONG && (
                                <button
                                  disabled={busy}
                                  onClick={() => onMasterRow(q.id)}
                                  className="rounded-sm border border-slate-300 bg-white px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-slate-700 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                                  style={{ fontFamily: MONO_FAMILY }}
                                >
                                  ↑ MASTERED
                                </button>
                              )}
                              <button
                                onClick={() => onToggleQuestion(q.id)}
                                aria-label={on ? "Selected" : "Select"}
                                title={on ? "Selected" : "Select"}
                                className={
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 transition-colors duration-120 " +
                                  (on
                                    ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                                    : "border-slate-300 text-transparent hover:border-[#1E3A8A]")
                                }
                              >
                                {on ? <Check size={12} strokeWidth={2} /> : null}
                              </button>
                            </>
                          }
                        />
                      );
                    })}
                  </QuestionCardGrid>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {items.map((q, i) => {
                      const on = selected.has(q.id);
                      const idxLabel = String(i + 1).padStart(3, "0");
                      return (
                        <li
                          key={q.id}
                          className="rep-row flex items-center gap-3 py-2.5"
                          style={{ animationDelay: `${i * 10}ms` }}
                        >
                          <span
                            className="w-8 shrink-0 font-mono text-[11px] tabular-nums text-slate-400"
                            style={{ fontFamily: MONO_FAMILY }}
                          >
                            {idxLabel}
                          </span>
                          <Latex
                            text={q.stem}
                            className="line-clamp-2 min-w-0 flex-1 text-[13px] text-slate-900"
                          />
                          <span
                            className="inline-flex h-[20px] shrink-0 items-center rounded-sm border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10.5px] uppercase tracking-tight text-slate-600"
                            style={{ fontFamily: MONO_FAMILY }}
                          >
                            {q.type}
                          </span>
                          {activeId === WRONG && (
                            <button
                              disabled={busy}
                              onClick={() => onMasterRow(q.id)}
                              className="shrink-0 rounded-sm border border-slate-300 bg-white px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-slate-700 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                              style={{ fontFamily: MONO_FAMILY }}
                            >
                              ↑ MASTERED
                            </button>
                          )}
                          <button
                            onClick={() => onToggleQuestion(q.id)}
                            aria-label={on ? "Selected" : "Select"}
                            title={on ? "Selected" : "Select"}
                            className={
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 transition-colors duration-120 " +
                              (on
                                ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                                : "border-slate-300 text-transparent hover:border-[#1E3A8A]")
                            }
                          >
                            {on ? <Check size={12} strokeWidth={2} /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {showingPager && total > PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span
                      className="font-mono text-[11px] text-slate-600"
                      style={{ fontFamily: MONO_FAMILY }}
                    >
                      PAGE {currentPage}/{pages} — {from}..{to} of {total}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={offset === 0}
                        onClick={() =>
                          setOffset((o) => Math.max(0, o - PAGE_SIZE))
                        }
                        aria-label="Previous page"
                        title="Previous page"
                        className="flex h-7 w-7 items-center justify-center rounded-sm border-2 border-slate-200 bg-white text-slate-600 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                      >
                        <ChevronLeft size={14} strokeWidth={1.5} />
                      </button>
                      <button
                        disabled={offset + PAGE_SIZE >= total}
                        onClick={() => setOffset((o) => o + PAGE_SIZE)}
                        aria-label="Next page"
                        title="Next page"
                        className="flex h-7 w-7 items-center justify-center rounded-sm border-2 border-slate-200 bg-white text-slate-600 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                      >
                        <ChevronRight size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Submit bar */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4">
        <span
          className="font-mono text-[11.5px] font-semibold text-[#1E3A8A]"
          style={{ fontFamily: MONO_FAMILY }}
        >
          [ {selected.size} SELECTED ]
        </span>

        <label
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-700"
          style={{ fontFamily: MONO_FAMILY }}
        >
          <input
            type="checkbox"
            checked={randomPick}
            onChange={(e) => setRandomPick(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#1E3A8A]"
          />
          RANDOM PICK
        </label>
        <input
          type="number"
          min={1}
          value={count}
          disabled={!randomPick}
          onChange={(e) =>
            setCount(Math.max(1, Number(e.target.value) || 1))
          }
          className="w-16 rounded-sm border-2 border-slate-200 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 focus:border-[#1E3A8A] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
          style={{ fontFamily: MONO_FAMILY }}
          aria-label="Random pick count"
        />
        <label
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-700"
          style={{ fontFamily: MONO_FAMILY }}
        >
          <input
            type="checkbox"
            checked={shuffleOptions}
            onChange={(e) => setShuffleOptions(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#1E3A8A]"
          />
          SHUFFLE OPTIONS
        </label>
        <label
          className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-700"
          title="Single/judge reveal the moment you pick (no Check button); multiple-choice still needs Submit. Both modes score and feed the wrong set."
          style={{ fontFamily: MONO_FAMILY }}
        >
          <input
            type="checkbox"
            checked={fastMode}
            onChange={(e) => setFastMode(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#1E3A8A]"
          />
          FAST MODE
        </label>

        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[11px] uppercase tracking-wider text-slate-500"
            style={{ fontFamily: MONO_FAMILY }}
          >
            AI:
          </span>
          <div className="inline-flex items-stretch overflow-hidden rounded-sm border border-slate-200">
            {(["off", "mixed", "ai"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAiMode(m)}
                className={
                  "px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider transition-colors duration-120 " +
                  (aiMode === m
                    ? "bg-[#1E3A8A] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50 hover:text-[#0B3B8C]")
                }
                style={{ fontFamily: MONO_FAMILY }}
              >
                {m === "off" ? "OFF" : m === "mixed" ? "MIXED" : "AI ONLY"}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={aiCount}
            disabled={aiMode === "off"}
            onChange={(e) =>
              setAiCount(
                Math.min(10, Math.max(1, Number(e.target.value) || 1)),
              )
            }
            className="w-14 rounded-sm border-2 border-slate-200 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 focus:border-[#1E3A8A] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            style={{ fontFamily: MONO_FAMILY }}
            aria-label="AI question count"
          />
        </div>

        <button
          disabled={selected.size === 0 || busy}
          onClick={onSubmit}
          className="ml-auto inline-flex items-center gap-2 rounded-sm border-2 border-[#1E3A8A] bg-[#1E3A8A] px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-white transition-colors duration-120 hover:bg-[#0B3B8C] disabled:opacity-60"
          style={{ fontFamily: MONO_FAMILY }}
        >
          <CornerDownLeft size={13} strokeWidth={1.5} />
          <span>START REVIEW</span>
          <span aria-hidden>→</span>
        </button>
      </div>
      <p
        className="mt-2 font-mono text-[11px] text-slate-500"
        style={{ fontFamily: MONO_FAMILY }}
      >
        Fast mode: single/judge reveal the moment you pick (no Check
        button); multiple-choice still needs Submit. AI: seeds are the
        questions you ticked (≥1 needed); generated questions are{" "}
        <strong className="text-slate-700">not</strong> saved to your bank
        automatically — use "Add to bank" during review. Your selection
        isn't saved between visits.
      </p>
      <TagManageDrawer
        open={manageOpen}
        onClose={async () => {
          setManageOpen(false);
          const live = new Set(tags.map((t) => t.id));
          const filtered = tagIds.filter((id) => live.has(id));
          if (filtered.length !== tagIds.length) setTagIds(filtered);
        }}
        tags={tags}
        onChanged={async () => {
          try {
            const t = await listTags();
            setTags(t);
            setTick((x) => x + 1);
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}
