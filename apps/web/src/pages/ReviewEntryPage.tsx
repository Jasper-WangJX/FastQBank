// The review picker (spec §6.1). Selection is ONE global Set<questionId>
// that survives switching tags — a question stays green wherever it
// appears (incl. multi-tagged). The tag column reuses listTags() (flat,
// rebuilt by parent_id like the tag panel); the main list reuses
// listQuestions({tagId}) (subtree + paginated). "Select all" uses the
// dedicated id endpoint so it covers the whole subtree, not just the
// loaded page. Selection is session-only (not persisted).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

  // Full id list of the active source (subtree or wrong set) — drives
  // the global toggle label/action so it reflects the WHOLE source,
  // not just the loaded page.
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const [randomPick, setRandomPick] = useState(false);
  const [count, setCount] = useState(20);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [aiMode, setAiMode] = useState<"off" | "mixed" | "ai">("off");
  const [aiCount, setAiCount] = useState(5);

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
  }, [activeId, tagIds, tagMatch, offset, tagFilterActive]);

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

  // "Select all" / "Deselect all" for the WHOLE active source (subtree
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Review</h1>

      {error && (
        <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex gap-4">
        {/* Tag column */}
        <div className="w-64 shrink-0 space-y-2">
          <div className="rounded-md border border-gray-200 p-2">
            <button
              onClick={() => {
                pick(WRONG);
                setTagIds([]);
              }}
              className={
                "block w-full rounded px-2 py-1 text-left text-sm " +
                (activeId === WRONG
                  ? "bg-amber-100 font-medium text-amber-900"
                  : "text-amber-800 hover:bg-amber-50")
              }
            >
              ⚠ Wrong questions ({wrongTotal})
            </button>
            <button
              onClick={() => {
                pick(ALL);
                setTagIds([]);
              }}
              className={
                "mt-1 block w-full rounded px-2 py-1 text-left text-sm " +
                (activeId === ALL && tagIds.length === 0
                  ? "bg-slate-800 text-white"
                  : "text-gray-700 hover:bg-gray-100")
              }
            >
              All questions
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
            variant="inline"
            disabled={activeId === WRONG || activeId === ALL}
            disabledHint="Cancel All / Wrong to filter by tag."
          />
        </div>

        {/* Main area: questions for the active source */}
        <div className="min-w-0 flex-1 rounded-md border border-gray-200 p-3">
          {activeId === "" && !tagFilterActive ? (
            <p className="text-sm text-gray-500">
              Select tags above (or choose All / Wrong questions) to start.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {activeId === WRONG
                    ? `Wrong questions (${total})`
                    : activeId === ALL
                      ? `All questions (${total})`
                      : `Questions (${total})`}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
                    <button
                      onClick={() => setView("list")}
                      className={
                        "px-2 py-1 " +
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
                        "px-2 py-1 " +
                        (view === "cards"
                          ? "bg-slate-800 text-white"
                          : "text-gray-600 hover:bg-gray-50")
                      }
                    >
                      Cards
                    </button>
                  </div>
                  <button
                    disabled={sourceIds.length === 0}
                    onClick={onToggleAll}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    {everySelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
              </div>

              {items === null ? (
                <p className="mt-3 text-sm text-gray-500">Loading…</p>
              ) : items.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  No questions here.
                </p>
              ) : view === "cards" ? (
                <div className="mt-3">
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
                                  className="rounded-md border border-amber-400 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  Mastered
                                </button>
                              )}
                              <button
                                onClick={() => onToggleQuestion(q.id)}
                                aria-label={on ? "Selected" : "Select"}
                                title={on ? "Selected" : "Select"}
                                className={
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-medium " +
                                  (on
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "border border-gray-300 text-gray-400 hover:bg-gray-50")
                                }
                              >
                                {on ? "✓" : ""}
                              </button>
                            </>
                          }
                        />
                      );
                    })}
                  </QuestionCardGrid>
                </div>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {items.map((q) => {
                    const on = selected.has(q.id);
                    return (
                      <div
                        key={q.id}
                        className="flex items-center gap-3 py-2"
                      >
                        <Latex
                          text={q.stem}
                          className="line-clamp-2 min-w-0 flex-1 text-sm text-gray-800"
                        />
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                          {q.type}
                        </span>
                        {activeId === WRONG && (
                          <button
                            disabled={busy}
                            onClick={() => onMasterRow(q.id)}
                            className="shrink-0 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                          >
                            Mastered
                          </button>
                        )}
                        <button
                          onClick={() => onToggleQuestion(q.id)}
                          aria-label={on ? "Selected" : "Select"}
                          title={on ? "Selected" : "Select"}
                          className={
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-medium " +
                            (on
                              ? "bg-green-600 text-white hover:bg-green-700"
                              : "border border-gray-300 text-gray-400 hover:bg-gray-50")
                          }
                        >
                          {on ? "✓" : ""}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {showingPager && total > PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
                    {total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={offset === 0}
                      onClick={() =>
                        setOffset((o) => Math.max(0, o - PAGE_SIZE))
                      }
                      className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <button
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => setOffset((o) => o + PAGE_SIZE)}
                      className="rounded-md border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bottom Submit bar */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-gray-200 pt-4 text-sm">
        <span className="font-semibold">{selected.size} selected</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={randomPick}
            onChange={(e) => setRandomPick(e.target.checked)}
          />
          Random pick
        </label>
        <input
          type="number"
          min={1}
          value={count}
          disabled={!randomPick}
          onChange={(e) =>
            setCount(Math.max(1, Number(e.target.value) || 1))
          }
          className="w-16 rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-50"
          aria-label="Random pick count"
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={shuffleOptions}
            onChange={(e) => setShuffleOptions(e.target.checked)}
          />
          Shuffle options
        </label>
        <label className="flex items-center gap-1" title="Single/judge reveal the moment you pick (no Check button); multiple-choice still needs Submit. Both modes score and feed the wrong set.">
          <input
            type="checkbox"
            checked={fastMode}
            onChange={(e) => setFastMode(e.target.checked)}
          />
          Fast mode
        </label>
        <div className="flex items-center gap-1">
          <span className="text-gray-600">AI:</span>
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs">
            {(["off", "mixed", "ai"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAiMode(m)}
                className={
                  "px-2 py-1 " +
                  (aiMode === m
                    ? "bg-slate-800 text-white"
                    : "text-gray-600 hover:bg-gray-50")
                }
              >
                {m === "off" ? "Off" : m === "mixed" ? "Mixed" : "AI only"}
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
            className="w-14 rounded-md border border-gray-300 px-2 py-1 disabled:bg-gray-50"
            aria-label="AI question count"
          />
        </div>
        <button
          disabled={selected.size === 0 || busy}
          onClick={onSubmit}
          className="ml-auto rounded-md bg-slate-800 px-4 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Submit · Start review →
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Fast mode: single/judge reveal the moment you pick (no Check
        button); multiple-choice still needs Submit. AI: seeds are the
        questions you ticked (≥1 needed); generated questions are{" "}
        <strong>not</strong> saved to your bank automatically — use "Add
        to question bank" during review. Your selection isn't saved
        between visits.
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
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
}
