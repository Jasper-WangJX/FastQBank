// A question rendered as a compact card: stem on top (LaTeX, clamped),
// options below (each clamped; the list is capped with a "+N more"),
// and a caller-supplied actions row at the bottom. QuestionCardGrid lays
// cards out responsively (N per row by viewport width); the caller keeps
// the page size unchanged. Used by the Question Bank and the review
// picker (different `actions`).
//
// Visual: "Sapphire Console" — sharp 2px corners, hairline slate-200
// borders, sapphire chips, monospace metadata, no shadows.

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { Question } from "../lib/qbank";
import Latex from "./Latex";

const MAX_OPTIONS_SHOWN = 4;

export function QuestionCard({
  question,
  actions,
  selectControl,
  showAnswer = false,
}: {
  question: Question;
  actions?: ReactNode;
  /** Optional icon-only checkbox (or any small control) rendered at the
   * top-left of the card. Lets QuestionListPage wire selection without
   * forking the card component. When undefined, no extra wrapper is
   * rendered around the stem. */
  selectControl?: ReactNode;
  /** When true, the correct option(s) are emphasized (emerald fill +
   * check). Driven by the Question Bank's "Show answers" toggle. */
  showAnswer?: boolean;
}) {
  const shown = question.options.slice(0, MAX_OPTIONS_SHOWN);
  const extra = question.options.length - shown.length;
  const correctSet = new Set(question.correct);
  return (
    <div className="group flex h-full flex-col rounded-sm border border-slate-200 bg-white p-3 transition-colors duration-150 hover:border-[#1E3A8A]">
      {selectControl !== undefined ? (
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">{selectControl}</div>
          <Latex
            text={question.stem}
            className="line-clamp-3 block flex-1 text-sm font-medium text-slate-900"
          />
        </div>
      ) : (
        <Latex
          text={question.stem}
          className="line-clamp-3 block text-sm font-medium text-slate-900"
        />
      )}
      <ul className="mt-2 flex-1 space-y-0.5 font-mono text-xs text-slate-600">
        {shown.map((o) => {
          const isCorrect = showAnswer && correctSet.has(o.label);
          return (
            <li
              key={o.label}
              className={
                "flex items-start gap-1 " +
                (isCorrect ? "-mx-1 rounded-sm bg-emerald-50 px-1" : "")
              }
            >
              <span
                className={
                  "shrink-0 font-medium " +
                  (isCorrect ? "text-emerald-700" : "text-[#0B3B8C]")
                }
              >
                {o.label}.
              </span>
              <Latex
                text={o.content}
                className={
                  "line-clamp-1 block min-w-0 flex-1 " +
                  (isCorrect ? "text-emerald-800" : "")
                }
              />
              {isCorrect && (
                <Check
                  size={12}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-emerald-600"
                  aria-label="Correct answer"
                />
              )}
            </li>
          );
        })}
        {extra > 0 && (
          <li className="font-mono text-xs text-slate-400">
            +{extra} more
            {showAnswer &&
              question.options
                .slice(MAX_OPTIONS_SHOWN)
                .some((o) => correctSet.has(o.label)) &&
              " (incl. answer)"}
          </li>
        )}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex h-[20px] items-center rounded-sm border border-[#0B3B8C]/15 bg-[#DBEAFE] px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-tight text-[#1E3A8A]">
          {question.type}
        </span>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
    </div>
  );
}

export function QuestionCardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
