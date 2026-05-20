/**
 * Variant A — "Pure White / Apple-clean".
 *
 * Design intent: an airy, surgical Question Bank surface that feels pure,
 * convenient and fast — almost no chrome, generous whitespace, a single
 * sky-500 accent reserved for the primary CTA and the active nav state.
 *
 * Icons needed (lucide-react names):
 *   - Search
 *   - Camera
 *   - Upload
 *   - Link2
 *   - Plus
 *   - Pencil
 *   - Trash2
 *   - Tag
 *   - ChevronLeft
 *   - ChevronRight
 *   - List
 *   - LayoutGrid
 *   - X
 *   - Check
 *   - Dot
 *
 * NOTE: this is a preview-only mock. No router / API / auth. Inline SVG
 * icons follow lucide conventions (stroke 1.5, currentColor, 16px box).
 */

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types & mock data
// ---------------------------------------------------------------------------

type QuestionType = "MCQ" | "FillBlank" | "TrueFalse";

interface MockTag {
  id: string;
  name: string;
}

interface MockQuestion {
  id: string;
  stem: string;
  type: QuestionType;
  tags: MockTag[];
  hiddenTagCount: number; // for the "+N" overflow
  timestamp: string;
  selected?: boolean;
}

const MOCK_QUESTIONS: MockQuestion[] = [
  {
    id: "q1",
    stem: "Solve for x in the equation \\(x^2 + 2x - 8 = 0\\). Which of the following values satisfies the equation?",
    type: "MCQ",
    tags: [
      { id: "t1", name: "Algebra" },
      { id: "t2", name: "Quadratic" },
      { id: "t3", name: "Grade 9" },
    ],
    hiddenTagCount: 2,
    timestamp: "2 min ago",
    selected: true,
  },
  {
    id: "q2",
    stem: "The derivative of \\(f(x) = \\sin(x)\\cos(x)\\) with respect to \\(x\\) equals which of the following expressions?",
    type: "MCQ",
    tags: [
      { id: "t4", name: "Calculus" },
      { id: "t5", name: "Trigonometry" },
    ],
    hiddenTagCount: 0,
    timestamp: "18 min ago",
    selected: true,
  },
  {
    id: "q3",
    stem: "The capital of Australia is ______.",
    type: "FillBlank",
    tags: [
      { id: "t6", name: "Geography" },
      { id: "t7", name: "World capitals" },
    ],
    hiddenTagCount: 1,
    timestamp: "1 hr ago",
  },
  {
    id: "q4",
    stem: "Every continuous function on a closed interval attains its maximum and minimum values.",
    type: "TrueFalse",
    tags: [
      { id: "t4", name: "Calculus" },
      { id: "t8", name: "Theorems" },
    ],
    hiddenTagCount: 0,
    timestamp: "3 hr ago",
    selected: true,
  },
  {
    id: "q5",
    stem: "Which of the following data structures uses LIFO (Last In, First Out) ordering for its elements?",
    type: "MCQ",
    tags: [
      { id: "t9", name: "Data structures" },
      { id: "t10", name: "CS fundamentals" },
    ],
    hiddenTagCount: 0,
    timestamp: "Yesterday",
  },
  {
    id: "q6",
    stem: "The chemical symbol for gold is ______, and its atomic number is ______.",
    type: "FillBlank",
    tags: [
      { id: "t11", name: "Chemistry" },
      { id: "t12", name: "Periodic table" },
    ],
    hiddenTagCount: 0,
    timestamp: "Yesterday",
  },
  {
    id: "q7",
    stem: "In a binary tree of height h, the maximum number of nodes is \\(2^{h+1} - 1\\).",
    type: "TrueFalse",
    tags: [
      { id: "t9", name: "Data structures" },
      { id: "t13", name: "Trees" },
      { id: "t14", name: "Discrete math" },
    ],
    hiddenTagCount: 0,
    timestamp: "2 days ago",
  },
  {
    id: "q8",
    stem: "Which keyword in JavaScript declares a block-scoped, immutable binding to a value?",
    type: "MCQ",
    tags: [
      { id: "t15", name: "JavaScript" },
      { id: "t16", name: "Web dev" },
    ],
    hiddenTagCount: 3,
    timestamp: "3 days ago",
  },
];

const MOCK_TAG_CHIPS: { id: string; name: string; active: boolean }[] = [
  { id: "tg1", name: "Algebra", active: true },
  { id: "tg2", name: "Calculus", active: true },
  { id: "tg3", name: "Geometry", active: false },
  { id: "tg4", name: "Statistics", active: false },
  { id: "tg5", name: "Physics", active: false },
  { id: "tg6", name: "Chemistry", active: false },
  { id: "tg7", name: "World capitals", active: false },
];

// ---------------------------------------------------------------------------
// Inline SVG icon set
// (lucide-react style: stroke 1.5, currentColor, 16x16 viewBox)
// ---------------------------------------------------------------------------

type IconProps = { className?: string };

function Icon({
  children,
  className = "h-4 w-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const SearchIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m13 13-2.7-2.7" />
  </Icon>
);

const CameraIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M2.5 5.5h2l1-1.5h5l1 1.5h2A1 1 0 0 1 14.5 6.5v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
    <circle cx="8" cy="9" r="2.4" />
  </Icon>
);

const UploadIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M8 10V2.5" />
    <path d="m5 5.5 3-3 3 3" />
    <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
  </Icon>
);

const Link2Icon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M6 8h4" />
    <path d="M7 11H4.5a3 3 0 0 1 0-6H7" />
    <path d="M9 5h2.5a3 3 0 0 1 0 6H9" />
  </Icon>
);

const PlusIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M8 3.5v9" />
    <path d="M3.5 8h9" />
  </Icon>
);

const PencilIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M11.5 2.5 13.5 4.5 5 13H3v-2z" />
    <path d="m10 4 2 2" />
  </Icon>
);

const TrashIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M2.5 4.5h11" />
    <path d="M6 4.5V3.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
    <path d="M4 4.5v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-8" />
    <path d="M6.75 7v4M9.25 7v4" />
  </Icon>
);

const TagIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M2.5 2.5h4l7 7-4 4-7-7z" />
    <circle cx="5" cy="5" r="0.75" />
  </Icon>
);

const ChevronLeftIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="m10 3-4 5 4 5" />
  </Icon>
);

const ChevronRightIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="m6 3 4 5-4 5" />
  </Icon>
);

const ListIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="M5.5 4h8" />
    <path d="M5.5 8h8" />
    <path d="M5.5 12h8" />
    <circle cx="3" cy="4" r="0.5" />
    <circle cx="3" cy="8" r="0.5" />
    <circle cx="3" cy="12" r="0.5" />
  </Icon>
);

const GridIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Icon>
);

const XIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="m4 4 8 8" />
    <path d="m12 4-8 8" />
  </Icon>
);

const CheckIcon = (p: IconProps) => (
  <Icon className={p.className}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionBankVariantA() {
  // Pre-compute particle positions so they don't reshuffle on re-render.
  const particles = useMemo(() => {
    // Deterministic-ish layout: spread 12 dots across the viewport.
    const seeds = [
      { top: 8, left: 6, size: 2, dur: 22, delay: -3 },
      { top: 14, left: 28, size: 1.5, dur: 18, delay: -7 },
      { top: 22, left: 55, size: 2, dur: 26, delay: -1 },
      { top: 18, left: 82, size: 1.5, dur: 20, delay: -10 },
      { top: 36, left: 12, size: 1.5, dur: 24, delay: -5 },
      { top: 44, left: 40, size: 2, dur: 28, delay: -12 },
      { top: 48, left: 70, size: 1.5, dur: 21, delay: -2 },
      { top: 58, left: 8, size: 2, dur: 25, delay: -14 },
      { top: 62, left: 35, size: 1.5, dur: 17, delay: -8 },
      { top: 70, left: 60, size: 2, dur: 30, delay: -6 },
      { top: 78, left: 86, size: 1.5, dur: 23, delay: -11 },
      { top: 86, left: 22, size: 1.5, dur: 19, delay: -4 },
    ];
    return seeds;
  }, []);

  const total = 87;
  const from = 1;
  const to = 10;
  const selectedCount = MOCK_QUESTIONS.filter((q) => q.selected).length;

  return (
    <div
      className='relative min-h-dvh overflow-x-hidden bg-white text-slate-900 font-[-apple-system,BlinkMacSystemFont,"SF_Pro",Inter,sans-serif] antialiased'
    >
      {/* Inline keyframes — global CSS untouched by design. */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes drift {
          0%   { transform: translate3d(0, 0, 0); }
          50%  { transform: translate3d(6px, -10px, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }
        @keyframes logoPulse {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .qba-drift, .qba-fadeup, .qba-logo-pulse {
            animation: none !important;
          }
        }
      `}</style>

      {/* Ambient particle layer (z-0, behind content) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
      >
        {particles.map((p, i) => (
          <span
            key={i}
            className="qba-drift absolute rounded-full bg-slate-300"
            style={{
              top: `${p.top}%`,
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              opacity: 0.08,
              animation: `drift ${p.dur}s ease-in-out ${p.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Sticky top header */}
      <header className="sticky top-0 z-30 h-14 border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-7">
            <a
              href="#"
              className="flex items-center gap-2"
              aria-label="FastQBank home"
            >
              <img
                src="/fastqb-logo.png"
                alt=""
                className="qba-logo-pulse h-6 w-6 rounded-md"
                style={{ animation: "logoPulse 600ms ease-out 1" }}
              />
              <span className="text-[15px] font-semibold tracking-tight text-slate-900">
                FastQBank
              </span>
            </a>
            <nav className="flex items-center gap-1 text-[13px]">
              {[
                { label: "Question Bank", active: true },
                { label: "New", active: false },
                { label: "Review", active: false },
              ].map((item) => (
                <a
                  key={item.label}
                  href="#"
                  className={
                    "relative px-3 py-1.5 transition-all duration-150 ease-out " +
                    (item.active
                      ? "text-slate-900"
                      : "text-slate-500 hover:text-slate-800")
                  }
                >
                  {item.label}
                  {item.active && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 -bottom-[15px] h-0.5 rounded-full bg-sky-500"
                    />
                  )}
                </a>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 text-[11px] font-semibold text-slate-600"
            >
              JW
            </div>
            <a
              href="#"
              className="text-[13px] text-slate-500 transition-colors hover:text-slate-800"
            >
              Log out
            </a>
          </div>
        </div>
      </header>

      {/* Main canvas */}
      <main className="relative z-10">
        <div className="mx-auto max-w-[1200px] px-6 pt-10 pb-20">
          {/* The page surface — pure white sitting on a soft slate-50 rail */}
          <div className="relative">
            {/* Soft rail behind the surface for separation */}
            <div
              aria-hidden="true"
              className="absolute -inset-x-3 -top-2 bottom-0 -z-10 rounded-2xl bg-slate-50"
            />

            {/* ============== Page title row ============== */}
            <section className="flex items-start justify-between gap-6">
              <div>
                <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
                  Question bank
                </h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                  Capture, tag, and bundle your questions. {total} questions across 23 tags.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title="OCR capture — screenshot a question on screen"
                  aria-label="OCR capture"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 ease-out hover:scale-[1.015] hover:border-slate-300 hover:text-slate-900"
                >
                  <CameraIcon className="h-[15px] w-[15px]" />
                </button>

                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200/70 bg-white px-3 text-[13px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 ease-out hover:border-slate-300 hover:text-slate-900"
                >
                  <UploadIcon className="h-[14px] w-[14px]" />
                  Import
                </button>

                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-slate-600 transition-colors duration-150 ease-out hover:text-slate-900"
                >
                  <Link2Icon className="h-[14px] w-[14px]" />
                  My shares
                </button>

                <button
                  type="button"
                  className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(14,165,233,0.25)] transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-sky-600"
                >
                  <PlusIcon className="h-[14px] w-[14px]" />
                  New question
                </button>
              </div>
            </section>

            {/* ============== Filter bar ============== */}
            <section className="mt-8 flex items-center gap-2">
              <div className="relative flex-1 max-w-md">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search stem, tag, or option…"
                  defaultValue="quadratic"
                  className="h-9 w-full rounded-lg border border-slate-200/70 bg-white pl-9 pr-16 text-[13px] text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-all duration-150 ease-out focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200/70 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight text-slate-400">
                  Cmd K
                </kbd>
              </div>

              <button
                type="button"
                className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] text-slate-500 transition-colors duration-150 ease-out hover:text-slate-800"
              >
                <XIcon className="h-[12px] w-[12px]" />
                Clear
              </button>

              <div className="ml-auto inline-flex items-center rounded-lg border border-slate-200/70 bg-white p-0.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <button
                  type="button"
                  aria-pressed="true"
                  title="List view"
                  className="grid h-7 w-7 place-items-center rounded-md bg-slate-100 text-slate-900 transition-all duration-150 ease-out hover:scale-[1.015]"
                >
                  <ListIcon className="h-[14px] w-[14px]" />
                </button>
                <button
                  type="button"
                  aria-pressed="false"
                  title="Card view"
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-all duration-150 ease-out hover:scale-[1.015] hover:text-slate-700"
                >
                  <GridIcon className="h-[14px] w-[14px]" />
                </button>
              </div>
            </section>

            {/* ============== Tag chips row ============== */}
            <section className="mt-4 flex flex-wrap items-center gap-1.5">
              {MOCK_TAG_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-all duration-150 ease-out " +
                    (chip.active
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-200/70 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900")
                  }
                >
                  {chip.active && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-sky-300"
                    />
                  )}
                  {chip.name}
                </button>
              ))}

              <div className="ml-2 inline-flex items-center rounded-md border border-slate-200/70 bg-white p-0.5 text-[11px] font-medium">
                <button
                  type="button"
                  className="rounded-[5px] bg-slate-100 px-2 py-0.5 text-slate-900"
                >
                  AND
                </button>
                <button
                  type="button"
                  className="rounded-[5px] px-2 py-0.5 text-slate-400 transition-colors hover:text-slate-700"
                >
                  OR
                </button>
              </div>
            </section>

            {/* ============== Bulk action bar ============== */}
            <section className="mt-5 flex items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="grid h-5 w-5 place-items-center rounded-md bg-sky-50 text-sky-600">
                <CheckIcon className="h-[12px] w-[12px]" />
              </div>
              <span className="text-[13px] font-medium text-slate-900">
                {selectedCount} selected
              </span>
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 text-[12px] text-slate-500 transition-colors hover:text-slate-800"
              >
                Clear
              </button>

              <span
                aria-hidden="true"
                className="mx-1 h-4 w-px bg-slate-200"
              />

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  title="Bulk delete"
                  aria-label="Bulk delete"
                  className="group grid h-7 w-7 place-items-center rounded-md text-slate-500 transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-red-50 hover:text-red-600"
                >
                  <TrashIcon className="h-[14px] w-[14px]" />
                </button>
                <button
                  type="button"
                  title="Add tag"
                  aria-label="Add tag"
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-slate-100 hover:text-slate-900"
                >
                  <TagIcon className="h-[14px] w-[14px]" />
                </button>
                <button
                  type="button"
                  title="Bundle as link"
                  aria-label="Bundle as link"
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-slate-100 hover:text-slate-900"
                >
                  <Link2Icon className="h-[14px] w-[14px]" />
                </button>
              </div>

              <span className="ml-auto text-[11px] text-slate-400">
                Selection persists across pages
              </span>
            </section>

            {/* ============== List ============== */}
            <section className="mt-4 overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              {MOCK_QUESTIONS.map((q, idx) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  isLast={idx === MOCK_QUESTIONS.length - 1}
                  stagger={idx * 20}
                />
              ))}
            </section>

            {/* ============== Pagination ============== */}
            <section className="mt-5 flex items-center justify-between">
              <span className="text-[12px] text-slate-500">
                {from}–{to} of {total}
              </span>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Previous page"
                  title="Previous page"
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-slate-100 hover:text-slate-900"
                >
                  <ChevronLeftIcon className="h-[14px] w-[14px]" />
                </button>

                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-current={n === 1 ? "page" : undefined}
                    className={
                      "grid h-8 min-w-8 place-items-center rounded-md px-2 text-[12px] font-medium transition-all duration-150 ease-out " +
                      (n === 1
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
                    }
                  >
                    {n}
                  </button>
                ))}
                <span className="px-1.5 text-[12px] text-slate-400">…</span>
                <button
                  type="button"
                  className="grid h-8 min-w-8 place-items-center rounded-md px-2 text-[12px] font-medium text-slate-600 transition-all duration-150 ease-out hover:bg-slate-100 hover:text-slate-900"
                >
                  9
                </button>

                <button
                  type="button"
                  aria-label="Next page"
                  title="Next page"
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition-all duration-150 ease-out hover:scale-[1.015] hover:bg-slate-100 hover:text-slate-900"
                >
                  <ChevronRightIcon className="h-[14px] w-[14px]" />
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

function QuestionRow({
  question,
  isLast,
  stagger,
}: {
  question: MockQuestion;
  isLast: boolean;
  stagger: number;
}) {
  const typeTone: Record<QuestionType, string> = {
    MCQ: "bg-slate-50 text-slate-700",
    FillBlank: "bg-amber-50 text-amber-800",
    TrueFalse: "bg-emerald-50 text-emerald-800",
  };

  return (
    <div
      className={
        "qba-fadeup group relative flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 ease-out hover:bg-slate-50/60 " +
        (isLast ? "" : "border-b border-slate-200/60")
      }
      style={{
        animation: `fadeUp 280ms ease-out ${stagger}ms both`,
      }}
    >
      {/* Hairline left accent — slides in on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2 left-0 w-0.5 origin-top scale-y-0 rounded-full bg-sky-500 transition-transform duration-200 ease-out group-hover:scale-y-100"
      />

      {/* Checkbox — 24x24 tap target, 16x16 visual */}
      <label className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          defaultChecked={question.selected}
          aria-label="Select this question"
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={
            "grid h-4 w-4 place-items-center rounded-[5px] border transition-colors " +
            (question.selected
              ? "border-sky-500 bg-sky-500 text-white"
              : "border-slate-300 bg-white text-transparent peer-hover:border-slate-400")
          }
        >
          {question.selected && <CheckIcon className="h-[10px] w-[10px]" />}
        </span>
      </label>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13.5px] leading-relaxed text-slate-800">
          {question.stem}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={
              "inline-flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-wide " +
              typeTone[question.type]
            }
          >
            {question.type}
          </span>
          {question.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="inline-flex h-5 items-center rounded-md border border-slate-200/70 bg-white px-1.5 text-[11px] text-slate-600"
            >
              {t.name}
            </span>
          ))}
          {question.hiddenTagCount > 0 && (
            <span className="inline-flex h-5 items-center rounded-md bg-slate-50 px-1.5 text-[11px] text-slate-500">
              +{question.hiddenTagCount}
            </span>
          )}
        </div>
      </div>

      {/* Timestamp + actions */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 text-[11px] text-slate-400">
          {question.timestamp}
        </span>
        <button
          type="button"
          title="Edit question"
          aria-label="Edit question"
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 opacity-40 transition-opacity duration-150 ease-out hover:bg-slate-100 hover:text-slate-900 group-hover:opacity-100"
        >
          <PencilIcon className="h-[14px] w-[14px]" />
        </button>
        <button
          type="button"
          title="Delete question"
          aria-label="Delete question"
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 opacity-40 transition-opacity duration-150 ease-out hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        >
          <TrashIcon className="h-[14px] w-[14px]" />
        </button>
      </div>
    </div>
  );
}
