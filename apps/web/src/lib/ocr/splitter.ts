// Turn the OCR sidecar's recognized text lines into a draft question
// (stem + options + inferred type) to prefill the stage-2 confirm form.
//
// Design notes, grounded in the Step-0 spike on real screenshots:
//   - The canonical exam format is lettered markers ("A. Earth",
//     "B) Mars", "(C) ...", lowercase "(a) ..."). That path is reliable
//     and reports `matched: true`.
//   - Screenshots often contain MORE than one question (the spike's
//     test3 had Q1 + Q2). We deliberately keep only the FIRST question;
//     the user reframes for the next one.
//   - Bare options with NO markers ("17 years / 49 years / ...") cannot
//     be split reliably once the stem wraps across lines (the spike's
//     test1). Rather than mis-split and make the user UNDO it, we put
//     the full text in the stem and report `matched: false` so the
//     confirm page can show an "auto-split failed, edit manually" hint.
//   - OCR can never know which option is correct, so `correct` is
//     always empty — the user marks it on the confirm page.
//
// English-only by product decision: no CJK markers/keywords.

import type { Option, QuestionType } from "../qbank";

export interface SplitResult {
  stem: string;
  type: QuestionType;
  options: Option[];
  /** Always [] — the user picks the answer on the confirm page. */
  correct: string[];
  /** false => low confidence; confirm page should prompt manual cleanup. */
  matched: boolean;
}

// "A." "A)" "(A)" "[a]" "a:" — a single letter wrapped/followed by one
// of . ) ] : , then the (possibly empty) option content. Capture 1 is
// the letter, capture 2 the content.
const MARKER = /^[([]?\s*([A-Za-z])\s*[)\].:]\s*(.*)$/;

// Leading question number to strip from the stem and to detect the
// boundary to the NEXT question: "1." "2)" "Q3." "P1-1.". Requires the
// trailing separator so we never eat into values like "1.5 kg".
const QNUM = /^\s*(?:[QP])?\d+(?:[-.]\d+)*\s*[.):]\s+/i;

const MULTI_KW =
  /\b(select all that apply|choose all that apply|all that apply|select all|choose all|more than one|multiple answers|multiple correct|\bmultiple\b)\b/i;
const JUDGE_KW = /\b(true or false|true\s*\/\s*false|\(\s*t\s*\/\s*f\s*\))\b/i;

const JUDGE_OPTIONS: Option[] = [
  { label: "T", content: "True" },
  { label: "F", content: "False" },
];

// Cheap heuristic: does this text look like it contains math the local
// OCR likely mangled? Used ONLY to nudge the user toward "Improve with
// AI" on the confirm page (stage 6) — never to auto-spend an API call.
const FORMULA_HINT =
  /(\\[a-zA-Z]+|\$.*\$|[=≤≥≠≈±×÷√∑∫∞πθ]|\^\s*\S|_\s*\{|\d\s*\/\s*\d|\bfrac\b|\bsqrt\b|\b(sin|cos|tan|log|lim|integral)\b)/;

export function looksLikeFormula(text: string): boolean {
  return FORMULA_HINT.test(text);
}

function blank(stem = "", matched = false): SplitResult {
  return {
    stem,
    type: "single",
    options: [
      { label: "A", content: "" },
      { label: "B", content: "" },
    ],
    correct: [],
    matched,
  };
}

function stripQNum(s: string): string {
  return s.replace(QNUM, "");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Options whose contents are exactly a True/False pair. */
function looksLikeJudge(opts: Option[]): boolean {
  if (opts.length !== 2) return false;
  const set = new Set(opts.map((o) => o.content.trim().toLowerCase()));
  return (
    (set.has("true") && set.has("false")) ||
    (set.has("t") && set.has("f")) ||
    (set.has("yes") && set.has("no"))
  );
}

function inferType(stem: string, options: Option[]): QuestionType {
  if (looksLikeJudge(options) || JUDGE_KW.test(stem)) return "judge";
  if (MULTI_KW.test(stem)) return "multi";
  return "single";
}

function finalize(stem: string, options: Option[], matched: boolean): SplitResult {
  const type = inferType(stem, options);
  if (type === "judge") {
    return { stem, type, options: JUDGE_OPTIONS, correct: [], matched };
  }
  return { stem, type, options, correct: [], matched };
}

/**
 * Split recognized OCR text lines into a draft question. `lines` is the
 * sidecar's reading-ordered text (callers pass `result.lines.map(l =>
 * l.text)`), keeping this function pure and trivially unit-testable.
 */
export function splitQuestion(rawLines: string[]): SplitResult {
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return blank();

  // Locate the first lettered option run that starts at A/a.
  let firstMarker = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = MARKER.exec(lines[i]);
    if (m && m[1].toUpperCase() === "A") {
      firstMarker = i;
      break;
    }
  }

  // No reliable markers: honest fallback. Whole text into the stem
  // (question number stripped), two empty options, matched: false.
  if (firstMarker === -1) {
    const stem = collapse(stripQNum(lines.join(" ")));
    return finalize(stem, blank().options, false);
  }

  const stemLines = lines.slice(0, firstMarker);
  const stem = collapse(stripQNum(stemLines.join(" ")));

  const options: Option[] = [];
  let expected = "A";
  for (let i = firstMarker; i < lines.length; i++) {
    const line = lines[i];
    const m = MARKER.exec(line);

    if (m && m[1].toUpperCase() === expected) {
      options.push({ label: expected, content: m[2].trim() });
      expected = String.fromCharCode(expected.charCodeAt(0) + 1);
      continue;
    }
    if (m) {
      // A marker, but not the next expected letter — the option run
      // ended (e.g. a new question's "A." after our "D.").
      break;
    }
    // Non-marker line: a new question number ends the first question;
    // otherwise it's a wrapped continuation of the last option.
    if (QNUM.test(line) && options.length >= 2) break;
    if (options.length > 0) {
      const last = options[options.length - 1];
      last.content = `${last.content} ${line}`.trim();
    }
    // (a stray pre-option line here is ignored — stem already captured)
  }

  // Fewer than two options recognized => treat as unreliable.
  if (options.length < 2) {
    const full = collapse(stripQNum(lines.join(" ")));
    return finalize(full, blank().options, false);
  }

  return finalize(stem, options, true);
}
