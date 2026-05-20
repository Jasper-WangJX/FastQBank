/**
 * Variant C — "Cool Mono / Linear-grid"
 * Design intent: a surgical, dense, indigo-accented data console that channels
 * Linear / Vercel docs / Stripe — hairline borders over shadows, mono metadata,
 * one cool accent, no fluff. Everything reads "fast".
 *
 * Icons needed (lucide-react names):
 *  - Search
 *  - Command
 *  - HelpCircle
 *  - LogOut
 *  - Camera
 *  - Upload
 *  - Link2
 *  - Plus
 *  - List
 *  - LayoutGrid
 *  - X            (clear / close)
 *  - Tag
 *  - Trash2
 *  - Pencil
 *  - ChevronLeft
 *  - ChevronRight
 *  - Check         (filter "AND" indicator dot — implemented as bare svg dot)
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirrors the real QuestionListOut shape — kept minimal for the preview)
// ---------------------------------------------------------------------------

type QuestionType = "MCQ" | "FillBlank" | "TrueFalse";

interface TagLite {
  id: string;
  name: string;
}

interface Question {
  id: string;          // display id like "Q-0042"
  stem: string;
  type: QuestionType;
  tags: TagLite[];
  updatedAt: string;   // mono-formatted timestamp string
}

// ---------------------------------------------------------------------------
// Inline SVG icons (stroke 1.5, currentColor, sharp corners)
// ---------------------------------------------------------------------------

type IconProps = { className?: string };

const baseSvg = "h-4 w-4";

function IconSearch({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
function IconCommand({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z" />
    </svg>
  );
}
function IconLogOut({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h12" />
    </svg>
  );
}
function IconCamera({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M3 7h4l2-2h6l2 2h4v12H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function IconUpload({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M4 17v3h16v-3" />
      <path d="M12 4v12" />
      <path d="M7 9l5-5 5 5" />
    </svg>
  );
}
function IconLink({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.5 7" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7L12.5 17" />
    </svg>
  );
}
function IconPlus({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function IconList({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}
function IconGrid({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  );
}
function IconX({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </svg>
  );
}
function IconTag({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}
function IconTrash({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}
function IconPencil({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="M14 5l4 4" />
    </svg>
  );
}
function IconChevronLeft({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
function IconChevronRight({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const ALL_TAGS: { id: string; name: string; active?: boolean }[] = [
  { id: "t-algebra", name: "Algebra", active: true },
  { id: "t-calc", name: "Calculus", active: true },
  { id: "t-prob", name: "Probability" },
  { id: "t-linalg", name: "Linear algebra" },
  { id: "t-stats", name: "Statistics" },
  { id: "t-geom", name: "Geometry" },
  { id: "t-discrete", name: "Discrete math" },
  { id: "t-ds", name: "Data structures" },
  { id: "t-net", name: "Networking" },
  { id: "t-os", name: "Operating systems" },
  { id: "t-2024", name: "2024 set" },
  { id: "t-mock", name: "Mock exam" },
];

const QUESTIONS: Question[] = [
  {
    id: "Q-0042",
    stem: "Which of the following best describes the time complexity of binary search on a sorted array of n elements?",
    type: "MCQ",
    tags: [{ id: "t-ds", name: "Data structures" }, { id: "t-algebra", name: "Algebra" }],
    updatedAt: "2026-05-18 14:22",
  },
  {
    id: "Q-0041",
    stem: "The derivative of sin(x) with respect to x equals ____ — fill in the blank.",
    type: "FillBlank",
    tags: [{ id: "t-calc", name: "Calculus" }],
    updatedAt: "2026-05-18 11:07",
  },
  {
    id: "Q-0040",
    stem: "TCP guarantees in-order delivery of bytes between two endpoints. True or false?",
    type: "TrueFalse",
    tags: [{ id: "t-net", name: "Networking" }, { id: "t-os", name: "OS" }, { id: "t-2024", name: "2024 set" }],
    updatedAt: "2026-05-17 22:51",
  },
  {
    id: "Q-0039",
    stem: "Let A be an n×n matrix. Which of these statements is equivalent to A being invertible?",
    type: "MCQ",
    tags: [{ id: "t-linalg", name: "Linear algebra" }],
    updatedAt: "2026-05-17 19:34",
  },
  {
    id: "Q-0038",
    stem: "A fair six-sided die is rolled twice. The probability that the sum is exactly 7 is ____.",
    type: "FillBlank",
    tags: [{ id: "t-prob", name: "Probability" }, { id: "t-stats", name: "Statistics" }],
    updatedAt: "2026-05-17 09:12",
  },
  {
    id: "Q-0037",
    stem: "In a binary heap, the parent of the node at index i is at index floor((i-1)/2). True or false?",
    type: "TrueFalse",
    tags: [{ id: "t-ds", name: "Data structures" }],
    updatedAt: "2026-05-16 23:48",
  },
  {
    id: "Q-0036",
    stem: "Which integration technique is most appropriate for evaluating the integral of x·e^x dx?",
    type: "MCQ",
    tags: [{ id: "t-calc", name: "Calculus" }, { id: "t-mock", name: "Mock exam" }],
    updatedAt: "2026-05-16 17:05",
  },
  {
    id: "Q-0035",
    stem: "The sum of the interior angles of a convex polygon with n sides equals ____ degrees.",
    type: "FillBlank",
    tags: [{ id: "t-geom", name: "Geometry" }],
    updatedAt: "2026-05-16 12:30",
  },
  {
    id: "Q-0034",
    stem: "Which of the following sorting algorithms has the best worst-case time complexity?",
    type: "MCQ",
    tags: [{ id: "t-ds", name: "Data structures" }, { id: "t-algebra", name: "Algebra" }, { id: "t-2024", name: "2024 set" }, { id: "t-mock", name: "Mock exam" }],
    updatedAt: "2026-05-15 21:14",
  },
  {
    id: "Q-0033",
    stem: "Every continuous function on a closed interval attains its maximum and minimum on that interval. True or false?",
    type: "TrueFalse",
    tags: [{ id: "t-calc", name: "Calculus" }, { id: "t-discrete", name: "Discrete" }],
    updatedAt: "2026-05-15 16:02",
  },
];

const TOTAL = 87;
const PAGE_FROM = 1;
const PAGE_TO = 10;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionBankVariantC() {
  // Track which rows are selected (preview state only).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["Q-0042", "Q-0040", "Q-0038"]),
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "cards">("list");
  const [activeTab, setActiveTab] = useState<"bank" | "new" | "review">("bank");
  const [tagMode, setTagMode] = useState<"AND" | "OR">("AND");
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  const allSelected = useMemo(
    () => QUESTIONS.every((q) => selected.has(q.id)),
    [selected],
  );
  const someSelected = !allSelected && selected.size > 0;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelected((prev) => {
      if (prev.size === QUESTIONS.length) return new Set();
      return new Set(QUESTIONS.map((q) => q.id));
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // Dot-grid + glow backdrop styles
  const pageBg: React.CSSProperties = {
    backgroundImage:
      "radial-gradient(rgba(148, 163, 184, 0.30) 1px, transparent 1.5px)",
    backgroundSize: "24px 24px",
    backgroundPosition: "0 0",
  };

  return (
    <div
      className="relative min-h-dvh w-full bg-white text-slate-900 antialiased"
      style={{
        fontFamily: 'ui-sans-serif, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        letterSpacing: "-0.005em",
      }}
    >
      {/* Inline keyframes + a few small style helpers. */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes drift {
          0%   { transform: translate(-10%, -10%); }
          50%  { transform: translate(70vw, 60vh); }
          100% { transform: translate(-10%, -10%); }
        }
        .vc-mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-feature-settings: "tnum" 1, "cv01" 1; }
        .vc-row-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: #6366F1; transform: scaleY(0); transform-origin: center; transition: transform 120ms ease-out; }
        .vc-row:hover .vc-row-bar { transform: scaleY(1); }
        .vc-row:hover .vc-row-actions { opacity: 1; }
        .vc-row-actions { opacity: 0; transition: opacity 100ms ease-out; }
        .vc-row { animation: fadeIn 150ms ease-out both; }
        .vc-glow { animation: drift 60s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .vc-glow { animation: none !important; }
          .vc-row { animation: none !important; }
        }
      `}</style>

      {/* Page background: dot-grid pattern */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={pageBg} aria-hidden />

      {/* Drifting indigo glow (very low opacity, blurred, multiply blend). */}
      <div
        aria-hidden
        className={`pointer-events-none fixed -z-10 ${reducedMotion ? "" : "vc-glow"}`}
        style={{
          width: 200,
          height: 200,
          background: "radial-gradient(closest-side, rgba(99,102,241,1), rgba(99,102,241,0) 70%)",
          opacity: 0.04,
          filter: "blur(120px)",
          mixBlendMode: "multiply",
          top: 0,
          left: 0,
        }}
      />

      {/* ======================= Header ======================= */}
      <header className="sticky top-0 z-30 h-[52px] w-full border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1280px] items-center gap-6 px-6">
          {/* Logo + wordmark */}
          <a href="#" className="flex items-center gap-2">
            <img
              src="/fastqb-logo.png"
              alt="FastQBank"
              className="h-[22px] w-[22px] rounded"
            />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              FastQBank
            </span>
          </a>

          {/* Middle nav */}
          <nav className="flex items-center gap-1 text-[13px]">
            {[
              { k: "bank", label: "Question Bank" },
              { k: "new", label: "New" },
              { k: "review", label: "Review" },
            ].map((item) => {
              const active = activeTab === item.k;
              return (
                <button
                  key={item.k}
                  onClick={() => setActiveTab(item.k as typeof activeTab)}
                  className={
                    "relative px-3 py-1.5 transition-colors duration-150 " +
                    (active
                      ? "text-indigo-600"
                      : "text-slate-600 hover:text-slate-900")
                  }
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-[15px] h-[2px] bg-indigo-500" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* ⌘K hint chip */}
            <span className="vc-mono flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-500">
              <IconCommand className="h-3 w-3" />K
            </span>
            <button
              title="Help"
              className="vc-mono flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-[12px] text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              ?
            </button>
            {/* Avatar */}
            <div
              title="Jasper W."
              className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-medium text-slate-50"
            >
              JW
            </div>
            <button
              title="Log out"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ======================= Main ======================= */}
      <main className="mx-auto max-w-[1280px] px-6 pt-8 pb-16">
        {/* ---- Page title row ---- */}
        <section className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Question bank
            </h1>
            <p className="vc-mono mt-1 text-[12px] text-slate-500">87 questions</p>
          </div>

          <div className="flex items-center gap-1.5">
            <IconButton title="OCR capture">
              <IconCamera />
            </IconButton>
            <IconButton title="Import">
              <IconUpload />
            </IconButton>
            <IconButton title="My shares">
              <IconLink />
            </IconButton>

            <span className="mx-1 h-5 w-px bg-slate-200" />

            <button
              className="flex h-8 items-center gap-2 rounded-md bg-indigo-500 px-3 text-[13px] font-medium text-slate-50 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] transition-colors duration-150 hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <IconPlus className="h-3.5 w-3.5" />
              New question
              <span className="vc-mono ml-1 flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/25 bg-white/10 px-1 text-[10px] leading-none text-white/90">
                N
              </span>
            </button>
          </div>
        </section>

        {/* ---- Filter bar ---- */}
        <section className="mt-6 flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              placeholder="Search stem…"
              className="vc-mono h-9 w-[420px] rounded-md border border-slate-200 bg-white pl-8 pr-16 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none transition-colors duration-150 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            <span className="vc-mono pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-[2px] text-[10px] text-slate-500">
              <IconCommand className="h-2.5 w-2.5" />K
            </span>
          </div>

          <button className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[12px] text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900">
            <IconX className="h-3.5 w-3.5" />
            Clear
          </button>

          <div className="ml-auto flex h-9 items-center rounded-md border border-slate-200 p-0.5">
            <button
              onClick={() => setView("list")}
              className={
                "relative flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors duration-150 " +
                (view === "list"
                  ? "bg-slate-50 text-slate-900"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              <IconList className="h-3.5 w-3.5" />
              List
              {view === "list" && (
                <span className="absolute inset-x-2 -bottom-[3px] h-[2px] bg-indigo-500" />
              )}
            </button>
            <button
              onClick={() => setView("cards")}
              className={
                "relative flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors duration-150 " +
                (view === "cards"
                  ? "bg-slate-50 text-slate-900"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              <IconGrid className="h-3.5 w-3.5" />
              Cards
              {view === "cards" && (
                <span className="absolute inset-x-2 -bottom-[3px] h-[2px] bg-indigo-500" />
              )}
            </button>
          </div>
        </section>

        {/* ---- Tag filters strip ---- */}
        <section className="mt-3">
          <div className="flex items-center gap-2">
            <div
              className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1"
              style={{ scrollbarWidth: "thin" }}
            >
              {ALL_TAGS.map((t) => {
                const active = !!t.active;
                return (
                  <button
                    key={t.id}
                    className={
                      "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors duration-150 " +
                      (active
                        ? "border-indigo-500 text-indigo-600"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900")
                    }
                  >
                    {active && (
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    )}
                    {t.name}
                  </button>
                );
              })}
            </div>

            {/* AND / OR mini-toggle */}
            <div className="flex h-7 shrink-0 items-center rounded-md border border-slate-200 p-0.5 text-[11px]">
              {(["AND", "OR"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTagMode(m)}
                  className={
                    "vc-mono h-6 rounded px-2 transition-colors duration-150 " +
                    (tagMode === m
                      ? "bg-slate-900 text-slate-50"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ---- Bulk action ribbon ---- */}
        {selected.size >= 1 && (
          <section
            className="mt-3 flex h-10 items-center gap-2 border-y border-slate-200 px-1 text-[12px]"
          >
            <span className="vc-mono text-slate-700">
              {selected.size} selected
            </span>
            <button
              onClick={clearSelection}
              className="rounded px-2 py-1 text-slate-500 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
            >
              Clear
            </button>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button
              title="Bulk delete"
              className="group flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors duration-150 hover:bg-slate-50 hover:text-red-500"
            >
              <IconTrash />
            </button>
            <button
              title="Add tag"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
            >
              <IconTag />
            </button>
            <button
              title="Bundle as link"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
            >
              <IconLink />
            </button>
            <span className="vc-mono ml-auto text-[11px] text-slate-400">
              esc to deselect
            </span>
          </section>
        )}

        {/* ---- List (data table) ---- */}
        <section className="mt-3 rounded-lg border border-slate-200 bg-white">
          {/* Table header */}
          <div className="flex h-9 items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-3">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={togglePage}
              className="h-4 w-4 cursor-pointer accent-indigo-500"
              title="Select page"
            />
            <span className="vc-mono w-[68px] text-[11px] uppercase tracking-wider text-slate-400">
              ID
            </span>
            <span className="vc-mono flex-1 text-[11px] uppercase tracking-wider text-slate-400">
              Stem
            </span>
            <span className="vc-mono w-20 text-[11px] uppercase tracking-wider text-slate-400">
              Type
            </span>
            <span className="vc-mono w-[220px] text-[11px] uppercase tracking-wider text-slate-400">
              Tags
            </span>
            <span className="vc-mono w-[120px] text-right text-[11px] uppercase tracking-wider text-slate-400">
              Updated
            </span>
            <span className="w-[64px]" />
          </div>

          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {QUESTIONS.map((qq, i) => {
              const isSel = selected.has(qq.id);
              const isHover = hoveredId === qq.id;
              return (
                <div
                  key={qq.id}
                  className="vc-row relative flex h-[52px] items-center gap-3 px-3 transition-colors duration-150 hover:bg-slate-50"
                  style={{ animationDelay: `${i * 15}ms` }}
                  onMouseEnter={() => setHoveredId(qq.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span className="vc-row-bar" />

                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleOne(qq.id)}
                    className="h-4 w-4 cursor-pointer accent-indigo-500"
                    title="Select this question"
                  />

                  <span className="vc-mono w-[68px] shrink-0 text-[12px] text-slate-400">
                    {qq.id}
                  </span>

                  <span className="block flex-1 truncate text-[13px] text-slate-800">
                    {qq.stem}
                  </span>

                  <span className="w-20 shrink-0">
                    <span className="vc-mono inline-flex h-[22px] items-center rounded border border-slate-200 px-1.5 text-[10.5px] uppercase tracking-wider text-slate-600">
                      {qq.type}
                    </span>
                  </span>

                  <span className="flex w-[220px] shrink-0 items-center gap-1 overflow-hidden">
                    {qq.tags.slice(0, 2).map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex h-[22px] max-w-[110px] shrink-0 items-center truncate rounded border border-slate-200 px-1.5 text-[11px] text-slate-600"
                      >
                        {t.name}
                      </span>
                    ))}
                    {qq.tags.length > 2 && (
                      <span className="vc-mono inline-flex h-[22px] shrink-0 items-center rounded border border-slate-200 px-1.5 text-[11px] text-slate-500">
                        +{qq.tags.length - 2}
                      </span>
                    )}
                  </span>

                  <span className="vc-mono w-[120px] shrink-0 text-right text-[11.5px] text-slate-500">
                    {qq.updatedAt}
                  </span>

                  <div className="vc-row-actions flex w-[64px] shrink-0 items-center justify-end gap-0.5">
                    <button
                      title="Edit"
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors duration-150 hover:bg-white hover:text-slate-900"
                      tabIndex={isHover ? 0 : -1}
                    >
                      <IconPencil />
                    </button>
                    <button
                      title="Delete"
                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors duration-150 hover:bg-white hover:text-red-500"
                      tabIndex={isHover ? 0 : -1}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- Pagination ---- */}
        <section className="mt-4 flex items-center justify-between">
          <span className="vc-mono text-[12px] text-slate-500">
            {PAGE_FROM}–{PAGE_TO} of {TOTAL}
          </span>
          <div className="flex items-center gap-1">
            <PagerIconButton title="Previous">
              <IconChevronLeft />
            </PagerIconButton>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <PagerNumberButton key={n} active={n === 1}>
                {n}
              </PagerNumberButton>
            ))}
            <PagerIconButton title="Next">
              <IconChevronRight />
            </PagerIconButton>
          </div>
        </section>

        {/* ---- Footer hint strip ---- */}
        <section className="vc-mono mt-10 flex items-center justify-between text-[11px] text-slate-400">
          <span>FastQBank · variant C · cool-mono / linear-grid</span>
          <span className="flex items-center gap-3">
            <span>
              <Kbd>N</Kbd> new
            </span>
            <span>
              <Kbd>/</Kbd> search
            </span>
            <span>
              <Kbd>?</Kbd> help
            </span>
          </span>
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

function IconButton({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors duration-150 hover:border-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
    >
      {children}
    </button>
  );
}

function PagerIconButton({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors duration-150 hover:border-slate-300 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function PagerNumberButton({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={
        "vc-mono flex h-7 w-7 items-center justify-center rounded-md text-[12px] transition-colors duration-150 " +
        (active
          ? "border border-indigo-500 text-indigo-600"
          : "border border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-900")
      }
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="vc-mono inline-flex h-[16px] min-w-[16px] items-center justify-center rounded border border-slate-200 bg-slate-50 px-1 text-[10px] leading-none text-slate-600">
      {children}
    </span>
  );
}
