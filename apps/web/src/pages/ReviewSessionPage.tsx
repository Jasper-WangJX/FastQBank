// The flashcard runner (spec §6.2/§6.3). Deck + flags arrive via router
// state from the picker; a direct hit / refresh has no state -> bounce
// to /review (in-memory deck is intentionally not resumable in v1).
//
// Split: an outer wrapper reads router state and bounces; the inner
// ReviewRunner holds all session state and is keyed by location.key, so
// "Review wrong now" (navigating /review/session -> /review/session with
// fresh state) fully remounts a brand-new session instead of reusing
// the stale deck/state.

import { useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Question } from "../lib/qbank";
import { getWrongSet, masterWrong, postReviewLog } from "../lib/review";
import {
  buildDeck,
  isAnswerCorrect,
  type DeckCard,
} from "../lib/review/session";
import Latex from "../components/Latex";

interface ReviewConfig {
  questions: Question[];
  requestedOrder: string[];
  randomOrder: boolean;
  shuffleOptions: boolean;
  fastMode: boolean;
  isWrongSetSession: boolean;
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

  // Build the deck ONCE (option order must stay stable for the session).
  // Reorder to selection order unless Random pick re-randomized it.
  const deck = useMemo<DeckCard[]>(() => {
    let qs = config.questions;
    if (!config.randomOrder) {
      const pos = new Map(config.requestedOrder.map((id, i) => [id, i]));
      qs = qs
        .slice()
        .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    }
    return buildDeck(qs, {
      randomOrder: config.randomOrder,
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
  const loggedRef = useRef<Set<number>>(new Set());

  if (deck.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-600">
          No questions to review.{" "}
          <button
            onClick={() => navigate("/review")}
            className="text-slate-700 underline"
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
        setWrongNote("No wrong questions — nothing to review. 🎉");
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
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Session complete</h1>
        <p className="mt-2 text-sm">
          ✅ {results.length - wrong.length} / {results.length} correct
          {"  "}·{"  "}❌ {wrong.length} wrong
        </p>
        {wrong.length > 0 && (
          <div className="mt-3 rounded-md border border-gray-200 p-3">
            <p className="mb-1 text-xs font-medium text-gray-500">
              Wrong this session
            </p>
            <ul className="space-y-1">
              {wrong.map((r) => (
                <li key={r.question.id}>
                  <Latex
                    text={r.question.stem}
                    className="line-clamp-1 block text-sm text-gray-700"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
        {wrongNote && (
          <p className="mt-3 text-sm text-amber-700">{wrongNote}</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onReviewWrongNow}
            className="rounded-md border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200"
          >
            Review wrong now
          </button>
          <button
            onClick={() => navigate("/review")}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Back to review home
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
    const correct = isAnswerCorrect(q, sel);
    setResults((r) => [...r, { question: q, correct }]);
    if (!loggedRef.current.has(idx)) {
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

  function next() {
    setIdx((i) => i + 1);
    setPicked([]);
    setRevealed(false);
    setLogError(null);
    setMasterError(null);
  }

  const correctSet = new Set(q.correct);
  const pickedSet = new Set(picked);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {logError && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{logError}</span>
          <button
            onClick={retryLog}
            className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Card {idx + 1} / {deck.length}
        </span>
        <span>{q.type}</span>
      </div>

      <div className="mt-3 text-base text-gray-900">
        <Latex text={q.stem} />
      </div>

      <div className="mt-4 space-y-2">
        {card.options.map((o) => {
          const isPicked = pickedSet.has(o.label);
          const isCorrect = correctSet.has(o.label);
          let cls =
            "border border-gray-300 bg-white hover:bg-gray-50";
          if (revealed && isCorrect)
            cls = "border-green-500 bg-green-50";
          else if (revealed && isPicked && !isCorrect)
            cls = "border-red-500 bg-red-50";
          else if (!revealed && isPicked)
            cls = "border-blue-500 bg-blue-50";
          return (
            <button
              key={o.label}
              disabled={revealed}
              onClick={() => togglePick(o.label)}
              className={
                "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm disabled:cursor-default " +
                cls
              }
            >
              <span className="font-medium text-gray-600">
                {o.label}.
              </span>
              <Latex text={o.content} className="flex-1" />
              {revealed && isCorrect && (
                <span className="text-green-700">✓</span>
              )}
              {revealed && isPicked && !isCorrect && (
                <span className="text-red-700">✗</span>
              )}
            </button>
          );
        })}
      </div>

      {revealed && q.knowledge_summary && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          💡 {q.knowledge_summary}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        {!revealed ? (
          <button
            disabled={picked.length === 0}
            onClick={() => doReveal()}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isMulti ? "Submit" : "Check"}
          </button>
        ) : (
          <>
            {isWrongSetSession && (
              <div className="flex items-center gap-2">
                <button
                  disabled={mastered.has(q.id)}
                  onClick={onMaster}
                  className="rounded-md border border-amber-500 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                >
                  {mastered.has(q.id) ? "Mastered ✓" : "Mark as mastered"}
                </button>
                {masterError && (
                  <span className="text-xs text-red-700">{masterError}</span>
                )}
              </div>
            )}
            <button
              onClick={next}
              className="ml-auto rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              {idx + 1 >= deck.length ? "Finish" : "Next →"}
            </button>
          </>
        )}
        <button
          onClick={() => navigate("/review")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
        >
          Quit
        </button>
      </div>
    </div>
  );
}
