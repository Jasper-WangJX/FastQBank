// The flashcard runner (spec §6.2/§6.3). Deck + flags arrive via router
// state from the picker; a direct hit / refresh has no state -> bounce
// to /review (in-memory deck is intentionally not resumable in v1).
//
// Split: an outer wrapper reads router state and bounces; the inner
// ReviewRunner holds all session state and is keyed by location.key, so
// "Review wrong now" (navigating /review/session -> /review/session with
// fresh state) fully remounts a brand-new session instead of reusing
// the stale deck/state.
//
// Visual layer: Sapphire Console (Variant E). Behavior preserved 1:1.

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CornerDownLeft,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import type { Question } from "../lib/qbank";
import { createQuestion } from "../lib/qbank";
import { getWrongSet, masterWrong, postReviewLog } from "../lib/review";
import { isAiCard } from "../lib/review/aiDraft";
import {
  buildDeck,
  isSelectionCorrect,
  type DeckCard,
} from "../lib/review/session";
import Latex from "../components/Latex";

const MONO_FAMILY =
  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace";

interface ReviewConfig {
  questions: Question[];
  requestedOrder: string[];
  randomOrder: boolean;
  shuffleOptions: boolean;
  fastMode: boolean;
  isWrongSetSession: boolean;
  notice?: string;
}

interface Result {
  question: Question;
  correct: boolean;
}

export default function ReviewSessionPage() {
  const location = useLocation();
  const config =
    (location.state as { reviewConfig?: ReviewConfig } | null)
      ?.reviewConfig ?? null;

  // No deck without router state (direct hit / refresh) -> bounce.
  if (!config) return <Navigate to="/review" replace />;

  // Key by location.key so navigating /review/session -> /review/session
  // (e.g. "Review wrong now") fully remounts a fresh session.
  return <ReviewRunner key={location.key} config={config} />;
}

function ReviewRunner({ config }: { config: ReviewConfig }) {
  const navigate = useNavigate();

  // Build the deck ONCE (option + card order must stay stable for the
  // session). Card order is ALWAYS randomized so a review run never
  // replays the questions in their selection order — independent of the
  // "Random pick" subset-sampling flag. (requestedOrder is therefore no
  // longer consulted here; it's kept in the config for callers/history.)
  const deck = useMemo<DeckCard[]>(() => {
    return buildDeck(config.questions, {
      randomOrder: true,
      shuffleOptions: config.shuffleOptions,
      rng: Math.random,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { fastMode, isWrongSetSession } = config;

  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [mastered, setMastered] = useState<Set<string>>(new Set());
  const [logError, setLogError] = useState<string | null>(null);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [wrongNote, setWrongNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    config.notice ?? null,
  );
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const loggedRef = useRef<Set<number>>(new Set());
  // Fast mode auto-advances each card after a brief pause; this holds
  // the pending timer so next()/unmount can cancel it (no double-skip).
  const advanceTimer = useRef<number | null>(null);

  // Cancel a pending fast-mode auto-advance if the runner unmounts
  // (e.g. Quit). Cleanup-only effect — no setState in the body, so it
  // satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    return () => {
      if (advanceTimer.current !== null) {
        window.clearTimeout(advanceTimer.current);
      }
    };
  }, []);

  if (deck.length === 0) {
    return (
      <div
        className="rounded-sm border-2 border-slate-200 bg-white p-6"
        style={{ fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif" }}
      >
        <p
          className="font-mono text-[12px] text-slate-600"
          style={{ fontFamily: MONO_FAMILY }}
        >
          &gt; No questions to review.{" "}
          <button
            onClick={() => navigate("/review")}
            className="text-[#0B3B8C] underline hover:text-[#1E3A8A]"
          >
            Back to review
          </button>
        </p>
      </div>
    );
  }

  const finished = idx >= deck.length;

  async function onReviewWrongNow() {
    setWrongNote(null);
    try {
      const w = await getWrongSet();
      if (w.items.length === 0) {
        setWrongNote("No wrong questions — nothing to review.");
        return;
      }
      navigate("/review/session", {
        state: {
          reviewConfig: {
            questions: w.items,
            requestedOrder: w.items.map((x) => x.id),
            randomOrder: false,
            shuffleOptions: config.shuffleOptions,
            fastMode: config.fastMode,
            isWrongSetSession: true,
          },
        },
      });
    } catch {
      setWrongNote("Couldn't load the wrong set. Try again.");
    }
  }

  if (finished) {
    const wrong = results.filter((r) => !r.correct);
    return (
      <div
        className="rounded-sm border-2 border-slate-200 bg-white p-6"
        style={{ fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif" }}
      >
        <div
          className="font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500"
          style={{ fontFamily: MONO_FAMILY }}
        >
          [ SESSION COMPLETE ]
        </div>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-[#0A2540]">
          Session complete
        </h1>
        <p
          className="mt-1 font-mono text-[12px] text-slate-700"
          style={{ fontFamily: MONO_FAMILY }}
        >
          &gt; ✓ {results.length - wrong.length}/{results.length} correct ·
          ✗ {wrong.length} wrong
        </p>
        {wrong.length > 0 && (
          <div className="mt-4 rounded-sm border-2 border-slate-200 p-3">
            <p
              className="mb-2 font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500"
              style={{ fontFamily: MONO_FAMILY }}
            >
              WRONG THIS SESSION
            </p>
            <ul className="space-y-1">
              {wrong.map((r) => (
                <li key={r.question.id} className="flex items-start gap-2">
                  <span
                    className="mt-0.5 shrink-0 font-mono text-[11px] text-red-600"
                    style={{ fontFamily: MONO_FAMILY }}
                  >
                    [ ! ]
                  </span>
                  <Latex
                    text={r.question.stem}
                    className="line-clamp-1 block flex-1 text-[13px] text-slate-700"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        {wrongNote && (
          <p
            className="mt-3 font-mono text-[12px] text-red-700"
            style={{ fontFamily: MONO_FAMILY }}
          >
            [ ERROR ] · {wrongNote}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onReviewWrongNow}
            className="inline-flex items-center gap-2 rounded-sm border-2 border-slate-300 bg-white px-3 py-2 font-mono text-[11.5px] uppercase tracking-wider text-slate-700 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C]"
            style={{ fontFamily: MONO_FAMILY }}
          >
            <span className="text-red-600">[ ! ]</span>
            <span>REVIEW WRONG NOW</span>
          </button>
          <button
            onClick={() => navigate("/review")}
            className="inline-flex items-center gap-2 rounded-sm border-2 border-[#1E3A8A] bg-[#1E3A8A] px-3 py-2 font-mono text-[11.5px] uppercase tracking-wider text-white transition-colors duration-120 hover:bg-[#0B3B8C]"
            style={{ fontFamily: MONO_FAMILY }}
          >
            <CornerDownLeft size={13} strokeWidth={1.5} />
            BACK TO REVIEW HOME
          </button>
        </div>
      </div>
    );
  }

  const card = deck[idx];
  const q = card.question;
  const isMulti = q.type === "multi";

  function togglePick(label: string) {
    if (revealed) return;
    if (isMulti) {
      setPicked((p) =>
        p.includes(label) ? p.filter((l) => l !== label) : [...p, label],
      );
    } else {
      setPicked([label]);
      if (fastMode) void doReveal([label]);
    }
  }

  async function doReveal(sel: string[] = picked) {
    if (revealed || sel.length === 0) return;
    setRevealed(true);
    const correct = isSelectionCorrect(card.correct, sel);
    setResults((r) => [...r, { question: q, correct }]);
    // Fast mode: linger briefly on the result, then auto-advance.
    if (fastMode) {
      advanceTimer.current = window.setTimeout(() => next(), 800);
    }
    // AI cards are ephemeral (no DB id) — never log them, so a wrong
    // answer also never enters the wrong set (spec §2.5).
    if (!isAiCard(q) && !loggedRef.current.has(idx)) {
      loggedRef.current.add(idx);
      try {
        await postReviewLog(q.id, correct);
        setLogError(null);
      } catch {
        loggedRef.current.delete(idx);
        setLogError(
          "Couldn't save this result. Your progress continues.",
        );
      }
    }
  }

  // Retry is only shown while `logError` is set, before `next()` — so
  // results[last] is always the current card's (un-logged) result.
  async function retryLog() {
    const last = results[results.length - 1];
    if (!last || loggedRef.current.has(idx)) return;
    loggedRef.current.add(idx);
    try {
      await postReviewLog(last.question.id, last.correct);
      setLogError(null);
    } catch {
      loggedRef.current.delete(idx);
      setLogError("Still couldn't save. Your progress continues.");
    }
  }

  async function onMaster() {
    try {
      await masterWrong(q.id);
      setMastered((m) => new Set(m).add(q.id));
      setMasterError(null);
    } catch {
      setMasterError("Couldn't mark mastered — click to try again.");
    }
  }

  async function onAddToBank() {
    if (added.has(q.id)) return;
    try {
      await createQuestion({
        stem: q.stem,
        type: q.type,
        options: q.options,
        correct: q.correct,
        knowledge_summary: q.knowledge_summary,
        tag_ids: q.tags.map((t) => t.id),
        source: "ai",
      });
      setAdded((s) => new Set(s).add(q.id));
      setAddError(null);
    } catch {
      setAddError("Couldn't add — click to retry.");
    }
  }

  function next() {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    setIdx((i) => i + 1);
    setPicked([]);
    setRevealed(false);
    setLogError(null);
    setMasterError(null);
    setAddError(null);
  }

  const correctSet = new Set(card.correct);
  const pickedSet = new Set(picked);

  return (
    <div
      className="rounded-sm border-2 border-slate-200 bg-white p-6"
      style={{ fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif" }}
    >
      {notice && (
        <div
          className="mb-3 flex items-center justify-between rounded-sm border border-[#1E3A8A] bg-[#EFF6FF] px-3 py-2"
          style={{ fontFamily: MONO_FAMILY }}
        >
          <span className="font-mono text-[12px] text-[#0B3B8C]">
            [ INFO ] · {notice}
          </span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            title="Dismiss"
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-[#1E3A8A]/40 text-[#0B3B8C] transition-colors duration-120 hover:bg-white"
          >
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {logError && (
        <div
          className="mb-3 flex items-center justify-between rounded-sm border-2 border-red-300 bg-red-50 px-3 py-2"
          style={{ fontFamily: MONO_FAMILY }}
        >
          <span className="font-mono text-[12px] text-red-700">
            [ ERROR ] · {logError}
          </span>
          <button
            onClick={retryLog}
            className="inline-flex items-center gap-1 rounded-sm border border-red-300 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-red-700 hover:bg-red-100"
          >
            <RotateCw size={11} strokeWidth={1.5} />
            Retry
          </button>
        </div>
      )}

      {/* Top metadata strip */}
      <div className="flex items-center justify-between">
        <span
          className="font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500"
          style={{ fontFamily: MONO_FAMILY }}
        >
          CARD {idx + 1} / {deck.length}
        </span>
        <span
          className="inline-flex h-[20px] items-center rounded-sm border border-slate-200 bg-slate-50 px-2 font-mono text-[10.5px] uppercase tracking-tight text-slate-600"
          style={{ fontFamily: MONO_FAMILY }}
        >
          [ {String(q.type).toUpperCase()} ]
        </span>
      </div>

      <div className="mt-3 text-[15px] text-slate-900">
        <Latex text={q.stem} />
      </div>

      <div className="mt-4 space-y-2">
        {card.options.map((o) => {
          const isPicked = pickedSet.has(o.label);
          const isCorrect = correctSet.has(o.label);
          // Default: hairline + white.
          let cls =
            "border-slate-200 bg-white hover:bg-[#EFF6FF] hover:border-[#1E3A8A]";
          // Reveal states (correct first — even if also picked). Correct
          // is GREEN so it can't be confused with the sapphire "selected"
          // highlight; a wrong pick is red.
          if (revealed && isCorrect)
            cls = "border-emerald-500 bg-emerald-50";
          else if (revealed && isPicked && !isCorrect)
            cls = "border-red-500 bg-red-50";
          else if (!revealed && isPicked)
            cls = "border-[#1E3A8A] bg-[#EFF6FF]";
          return (
            <button
              key={o.label}
              disabled={revealed}
              onClick={() => togglePick(o.label)}
              className={
                "flex w-full items-start gap-2 rounded-sm border-2 px-3 py-2 text-left text-[13.5px] transition-colors duration-120 disabled:cursor-default " +
                cls
              }
            >
              <span
                className="shrink-0 font-mono text-[12px] font-medium text-slate-600"
                style={{ fontFamily: MONO_FAMILY }}
              >
                {o.label}.
              </span>
              <Latex text={o.content} className="flex-1 text-slate-900" />
              {/* Trailing mono chip — order matters: correct beats wrong-pick. */}
              {revealed && isCorrect ? (
                <span
                  className="shrink-0 rounded-sm border border-emerald-400 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-700"
                  style={{ fontFamily: MONO_FAMILY }}
                >
                  [OK]
                </span>
              ) : revealed && isPicked && !isCorrect ? (
                <span
                  className="shrink-0 rounded-sm border border-red-300 bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-700"
                  style={{ fontFamily: MONO_FAMILY }}
                >
                  [X]
                </span>
              ) : !revealed && isPicked ? (
                <span
                  className="shrink-0 rounded-sm border border-[#1E3A8A] bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#0B3B8C]"
                  style={{ fontFamily: MONO_FAMILY }}
                >
                  [SELECTED]
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {revealed && q.knowledge_summary && (
        <div className="mt-4 rounded-sm border-2 border-slate-200 bg-[#EFF6FF] px-3 py-2.5">
          <div
            className="mb-1 font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500"
            style={{ fontFamily: MONO_FAMILY }}
          >
            KNOWLEDGE SUMMARY
          </div>
          <Latex
            text={q.knowledge_summary}
            className="text-[13.5px] text-slate-800"
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!revealed ? (
          // Fast mode + single/judge: picking auto-reveals, so the
          // Check button is useless and hidden. Multi still needs
          // Submit; non-fast always needs Check/Submit.
          fastMode && !isMulti ? null : (
            <button
              disabled={picked.length === 0}
              onClick={() => doReveal()}
              className="ml-auto inline-flex items-center gap-2 rounded-sm border-2 border-[#1E3A8A] bg-[#1E3A8A] px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-white transition-colors duration-120 hover:bg-[#0B3B8C] disabled:opacity-60"
              style={{ fontFamily: MONO_FAMILY }}
            >
              <CornerDownLeft size={13} strokeWidth={1.5} />
              {isMulti ? "SUBMIT" : "CHECK"}
            </button>
          )
        ) : (
          <>
            {/* Only offer "mastered" when this attempt was correct —
                a still-wrong redo shouldn't be markable as mastered. */}
            {isWrongSetSession && isSelectionCorrect(card.correct, picked) && (
              <div className="flex items-center gap-2">
                <button
                  disabled={mastered.has(q.id)}
                  onClick={onMaster}
                  className="inline-flex items-center gap-1 rounded-sm border-2 border-slate-300 bg-white px-3 py-2 font-mono text-[11.5px] uppercase tracking-wider text-slate-700 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
                  style={{ fontFamily: MONO_FAMILY }}
                >
                  <span aria-hidden>↑</span>
                  {mastered.has(q.id) ? "MASTERED ✓" : "MASTERED"}
                </button>
                {masterError && (
                  <span
                    className="font-mono text-[11px] text-red-700"
                    style={{ fontFamily: MONO_FAMILY }}
                  >
                    [ ERROR ] · {masterError}
                  </span>
                )}
              </div>
            )}
            {/* Fast mode auto-advances; only non-fast shows Next. */}
            {!fastMode && (
              <button
                onClick={next}
                className="ml-auto inline-flex items-center gap-2 rounded-sm border-2 border-[#1E3A8A] bg-[#1E3A8A] px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-white transition-colors duration-120 hover:bg-[#0B3B8C]"
                style={{ fontFamily: MONO_FAMILY }}
              >
                {idx + 1 >= deck.length ? "FINISH" : "NEXT"}
                <ArrowRight size={13} strokeWidth={1.5} />
              </button>
            )}
          </>
        )}
        {isAiCard(q) && (
          <div className="flex items-center gap-2">
            <button
              disabled={added.has(q.id)}
              onClick={onAddToBank}
              className="inline-flex items-center gap-1 rounded-sm border-2 border-slate-300 bg-white px-3 py-2 font-mono text-[11.5px] uppercase tracking-wider text-slate-700 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C] disabled:opacity-50"
              style={{ fontFamily: MONO_FAMILY }}
            >
              <Plus size={12} strokeWidth={1.5} />
              {added.has(q.id) ? "ADDED ✓" : "ADD TO BANK"}
            </button>
            {addError && (
              <span
                className="font-mono text-[11px] text-red-700"
                style={{ fontFamily: MONO_FAMILY }}
              >
                [ ERROR ] · {addError}
              </span>
            )}
          </div>
        )}
        <button
          onClick={() => navigate("/review")}
          className="inline-flex items-center gap-1 rounded-sm border-2 border-slate-300 bg-white px-3 py-2 font-mono text-[11.5px] uppercase tracking-wider text-slate-600 transition-colors duration-120 hover:border-[#1E3A8A] hover:text-[#0B3B8C]"
          style={{ fontFamily: MONO_FAMILY }}
        >
          QUIT
        </button>
      </div>
    </div>
  );
}
