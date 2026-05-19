// A question rendered as a compact card: stem on top (LaTeX, clamped),
// options below (each clamped; the list is capped with a "+N more…"),
// and a caller-supplied actions row at the bottom. QuestionCardGrid lays
// cards out responsively (N per row by viewport width); the caller keeps
// the page size unchanged. Used by the Question Bank and the review
// picker (different `actions`).

import type { ReactNode } from "react";
import type { Question } from "../lib/qbank";
import Latex from "./Latex";

const MAX_OPTIONS_SHOWN = 4;

export function QuestionCard({
  question,
  actions,
}: {
  question: Question;
  actions?: ReactNode;
}) {
  const shown = question.options.slice(0, MAX_OPTIONS_SHOWN);
  const extra = question.options.length - shown.length;
  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <Latex
        text={question.stem}
        className="line-clamp-3 block text-sm font-medium text-gray-800"
      />
      <ul className="mt-2 flex-1 space-y-0.5">
        {shown.map((o) => (
          <li key={o.label} className="flex gap-1 text-xs text-gray-600">
            <span className="shrink-0 font-medium">{o.label}.</span>
            <Latex text={o.content} className="line-clamp-1 block" />
          </li>
        ))}
        {extra > 0 && (
          <li className="text-xs text-gray-400">+{extra} more…</li>
        )}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
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
