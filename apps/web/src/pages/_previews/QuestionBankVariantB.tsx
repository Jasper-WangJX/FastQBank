/**
 * Variant B — "Soft Pastel / Raycast-bloom"
 *
 * Design intent: a cozy, warm-modern Question Bank screen that keeps the
 * page fast and uncluttered while breathing softness through pastel
 * blurred blobs, mint accents, and gentle card lifts.
 *
 * Icons needed (lucide-react names):
 *  - Search
 *  - Camera
 *  - Upload
 *  - Link2
 *  - Plus
 *  - List
 *  - LayoutGrid
 *  - Pencil
 *  - Trash2
 *  - Tag
 *  - X
 *  - ChevronLeft
 *  - ChevronRight
 *  - LogOut
 *  - Command (the ⌘ glyph in the shortcut chip)
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ---- Types (mirrors the live page's data shape, kept minimal) -------------

type QType = "MCQ" | "FillBlank" | "TrueFalse";

interface MockTag {
  id: string;
  name: string;
}

interface Question {
  id: string;
  stem: string;
  type: QType;
  tags: MockTag[];
  updatedAt: string; // human-readable, mock only
}

// ---- Mock data ------------------------------------------------------------

const ALL_TAGS: MockTag[] = [
  { id: "t-calc", name: "Calculus" },
  { id: "t-alg", name: "Algebra" },
  { id: "t-stats", name: "Statistics" },
  { id: "t-prob", name: "Probability" },
  { id: "t-lin", name: "Linear Algebra" },
  { id: "t-geo", name: "Geometry" },
  { id: "t-hist", name: "History" },
  { id: "t-bio", name: "Biology" },
];

const QUESTIONS: Question[] = [
  {
    id: "q1",
    stem: "Evaluate the definite integral \\(\\int_0^1 x\\,dx\\). Which of the following gives the correct value?",
    type: "MCQ",
    tags: [ALL_TAGS[0], ALL_TAGS[1]],
    updatedAt: "2 min ago",
  },
  {
    id: "q2",
    stem: "A fair six-sided die is rolled twice. What is the probability that the sum equals 7?",
    type: "MCQ",
    tags: [ALL_TAGS[2], ALL_TAGS[3]],
    updatedAt: "18 min ago",
  },
  {
    id: "q3",
    stem: "The derivative of \\(\\sin(x^2)\\) with respect to \\(x\\) is __________.",
    type: "FillBlank",
    tags: [ALL_TAGS[0]],
    updatedAt: "1 hr ago",
  },
  {
    id: "q4",
    stem: "True or False: Every continuous function on a closed interval \\([a,b]\\) attains its maximum on that interval.",
    type: "TrueFalse",
    tags: [ALL_TAGS[0], ALL_TAGS[4]],
    updatedAt: "3 hr ago",
  },
  {
    id: "q5",
    stem: "If \\(A\\) is a 3×3 matrix with \\(\\det(A)=2\\), what is \\(\\det(2A)\\)?",
    type: "MCQ",
    tags: [ALL_TAGS[4], ALL_TAGS[1]],
    updatedAt: "yesterday",
  },
  {
    id: "q6",
    stem: "The sum of the interior angles of a convex hexagon equals __________ degrees.",
    type: "FillBlank",
    tags: [ALL_TAGS[5]],
    updatedAt: "yesterday",
  },
  {
    id: "q7",
    stem: "True or False: The Treaty of Westphalia (1648) is widely regarded as the origin of the modern nation-state system.",
    type: "TrueFalse",
    tags: [ALL_TAGS[6]],
    updatedAt: "2 days ago",
  },
  {
    id: "q8",
    stem: "Which organelle is primarily responsible for ATP production through oxidative phosphorylation in eukaryotic cells?",
    type: "MCQ",
    tags: [ALL_TAGS[7], ALL_TAGS[2]],
    updatedAt: "3 days ago",
  },
];

// ---- Inline icons (stroke 1.5, currentColor, viewBox 24) -------------------

type IconProps = { className?: string };

function IconSearch({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function IconCamera({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function IconUpload({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconLink({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M10.5 6.5 12 5a4 4 0 0 1 5.7 5.7l-1.5 1.5" />
      <path d="M13.5 17.5 12 19a4 4 0 0 1-5.7-5.7l1.5-1.5" />
    </svg>
  );
}
function IconPlus({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconList({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}
function IconGrid({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconPencil({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20h4l11-11-4-4L4 16Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}
function IconTrash({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
function IconTag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20.6 13 13 20.6a1.4 1.4 0 0 1-2 0L3 12.6V4a1 1 0 0 1 1-1h8.6L20.6 11a1.4 1.4 0 0 1 0 2Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}
function IconX({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
function IconChevLeft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}
function IconChevRight({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}
function IconLogOut({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}
function IconCmd({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" />
    </svg>
  );
}

// ---- Small presentational pieces ------------------------------------------

const TYPE_DOT: Record<QType, string> = {
  MCQ: "#6EE7B7",       // mint
  FillBlank: "#FDBA74", // peach
  TrueFalse: "#93C5FD", // sky
};

const TYPE_TINT: Record<QType, string> = {
  MCQ: "#ECFDF5",
  FillBlank: "#FFF7ED",
  TrueFalse: "#EFF6FF",
};

// ---- Main component -------------------------------------------------------

export default function QuestionBankVariantB() {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["q1", "q3", "q5"]),
  );
  const [activeTags, setActiveTags] = useState<Set<string>>(
    () => new Set(["t-calc", "t-prob"]),
  );
  const [tagMatch, setTagMatch] = useState<"AND" | "OR">("AND");
  const [view, setView] = useState<"list" | "cards">("list");
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Trigger the on-mount card stagger.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ⌘K / Ctrl+K focuses the search input — a small Raycast-flavored touch.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTag(id: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QUESTIONS;
    return QUESTIONS.filter((it) => it.stem.toLowerCase().includes(q));
  }, [query]);

  const total = 87;
  const fromIdx = 1;
  const toIdx = 10;

  return (
    <div
      className="relative min-h-dvh overflow-hidden text-slate-800"
      style={{
        backgroundColor: "#FAFAF7",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      {/* Inline keyframes + reduced-motion guard. Defining them in-component
          keeps this variant fully self-contained. */}
      <style>{`
        @keyframes vb-drift-1 { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,-30px) scale(1.08)} 100%{transform:translate(0,0) scale(1)} }
        @keyframes vb-drift-2 { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,40px) scale(1.12)} 100%{transform:translate(0,0) scale(1)} }
        @keyframes vb-drift-3 { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(30px,50px) scale(1.05)} 100%{transform:translate(0,0) scale(1)} }
        @keyframes vb-drift-4 { 0%{transform:translate(0,0) scale(1)} 50%{transform:translate(-30px,-40px) scale(1.1)} 100%{transform:translate(0,0) scale(1)} }
        @keyframes vb-fade-up { 0%{opacity:0; transform:translateY(8px)} 100%{opacity:1; transform:translateY(0)} }
        @keyframes vb-breath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
        .vb-card { opacity: 0; transform: translateY(8px); transition: box-shadow 200ms ease-out, transform 200ms ease-out; }
        .vb-card.is-mounted { animation: vb-fade-up 380ms ease-out forwards; }
        .vb-card:hover { transform: translateY(-2px); box-shadow: 0 2px 6px rgba(15,23,42,0.05), 0 14px 32px -14px rgba(15,23,42,0.10); }
        .vb-primary { transition: box-shadow 180ms ease-out, transform 180ms ease-out, background-color 180ms ease-out; }
        .vb-primary:hover { box-shadow: 0 0 0 4px rgba(110,231,183,0.25), inset 0 0 0 1px rgba(255,255,255,0.5); background-color: #7AF0C2; }
        .vb-btn { transition: background-color 180ms ease-out, color 180ms ease-out, border-color 180ms ease-out; }
        .vb-icon-btn { transition: background-color 180ms ease-out, color 180ms ease-out, opacity 180ms ease-out; }
        .vb-logo { animation: vb-breath 4s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) {
          .vb-blob, .vb-logo { animation: none !important; }
          .vb-card { opacity: 1; transform: none; animation: none !important; }
          .vb-card:hover { transform: none; }
        }
      `}</style>

      {/* Warm radial tint in the top-right corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(900px 600px at 100% -10%, rgba(254,215,170,0.45), rgba(254,215,170,0) 60%)",
        }}
      />

      {/* Soft blurred particle blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="vb-blob absolute"
          style={{
            top: "12%", left: "-4%", width: 280, height: 280,
            background: "radial-gradient(circle, rgba(110,231,183,0.7), rgba(110,231,183,0) 70%)",
            filter: "blur(80px)", opacity: 0.16,
            animation: "vb-drift-1 48s ease-in-out infinite",
          }}
        />
        <div
          className="vb-blob absolute"
          style={{
            top: "44%", left: "22%", width: 260, height: 260,
            background: "radial-gradient(circle, rgba(147,197,253,0.7), rgba(147,197,253,0) 70%)",
            filter: "blur(80px)", opacity: 0.14,
            animation: "vb-drift-2 56s ease-in-out infinite",
          }}
        />
        <div
          className="vb-blob absolute"
          style={{
            top: "60%", left: "60%", width: 300, height: 300,
            background: "radial-gradient(circle, rgba(253,186,116,0.65), rgba(253,186,116,0) 70%)",
            filter: "blur(80px)", opacity: 0.15,
            animation: "vb-drift-3 52s ease-in-out infinite",
          }}
        />
        <div
          className="vb-blob absolute"
          style={{
            top: "8%", left: "70%", width: 240, height: 240,
            background: "radial-gradient(circle, rgba(196,181,253,0.6), rgba(196,181,253,0) 70%)",
            filter: "blur(80px)", opacity: 0.13,
            animation: "vb-drift-4 44s ease-in-out infinite",
          }}
        />
        <div
          className="vb-blob absolute"
          style={{
            top: "78%", left: "10%", width: 220, height: 220,
            background: "radial-gradient(circle, rgba(110,231,183,0.55), rgba(110,231,183,0) 70%)",
            filter: "blur(80px)", opacity: 0.12,
            animation: "vb-drift-2 60s ease-in-out infinite",
          }}
        />
        <div
          className="vb-blob absolute"
          style={{
            top: "30%", left: "85%", width: 220, height: 220,
            background: "radial-gradient(circle, rgba(253,186,116,0.55), rgba(253,186,116,0) 70%)",
            filter: "blur(80px)", opacity: 0.14,
            animation: "vb-drift-1 50s ease-in-out infinite",
          }}
        />
      </div>

      {/* Glass top header */}
      <header
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: "rgba(255,255,255,0.7)",
          borderBottom: "1px solid rgba(226,232,240,0.7)",
          height: 60,
        }}
      >
        <div className="mx-auto flex h-full max-w-[1200px] items-center gap-4 px-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <img
              src="/fastqb-logo.png"
              alt="FastQBank"
              className="vb-logo h-7 w-7 rounded-xl"
              style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.06)" }}
            />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              FastQBank
            </span>
          </div>

          {/* Pill nav */}
          <nav className="ml-6 flex items-center gap-1 rounded-full border border-slate-200/60 bg-white/60 p-1">
            <button
              className="vb-btn rounded-full px-3.5 py-1.5 text-xs font-medium text-slate-900"
              style={{ backgroundColor: "#6EE7B7" }}
            >
              Question Bank
            </button>
            <button className="vb-btn rounded-full px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Review
            </button>
            <button className="vb-btn rounded-full px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Stats
            </button>
            <button className="vb-btn rounded-full px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Settings
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {/* ⌘K shortcut chip */}
            <button
              onClick={() => searchRef.current?.focus()}
              className="vb-btn flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/70 px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-700"
              title="Focus search (⌘K)"
            >
              <IconCmd className="h-3.5 w-3.5" />
              <span className="font-medium">K</span>
            </button>

            {/* Avatar */}
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-slate-900"
              style={{
                background: "linear-gradient(135deg, #FED7AA 0%, #6EE7B7 100%)",
              }}
              title="Jasper"
            >
              JW
            </div>

            {/* Log out */}
            <button
              className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              title="Log out"
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content column */}
      <main className="relative z-10 mx-auto max-w-[1200px] px-6 py-8">
        {/* Page title row */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">
              Question bank
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              87 questions · last updated today
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="vb-icon-btn flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-slate-600 hover:text-slate-900"
              title="OCR capture — screenshot a question and import it"
            >
              <IconCamera className="h-4 w-4" />
            </button>
            <button
              className="vb-icon-btn flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-slate-600 hover:text-slate-900"
              title="Import from share link"
            >
              <IconUpload className="h-4 w-4" />
            </button>
            <button
              className="vb-icon-btn flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-slate-600 hover:text-slate-900"
              title="My shares"
            >
              <IconLink className="h-4 w-4" />
            </button>
            <button
              className="vb-primary flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-slate-900"
              style={{ backgroundColor: "#6EE7B7" }}
              title="Create a new question"
            >
              <IconPlus className="h-4 w-4" />
              New question
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-6 flex items-center gap-3">
          <div
            className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200/60 bg-white px-4 py-3"
            style={{
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.06)",
            }}
          >
            <IconSearch className="h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search question stems, tags, or types…"
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <kbd className="flex items-center gap-1 rounded-md border border-slate-200/70 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              <IconCmd className="h-3 w-3" />K
            </kbd>
          </div>
          <button className="vb-btn rounded-2xl px-3 py-3 text-sm text-slate-500 hover:bg-white hover:text-slate-800">
            Clear
          </button>
          <div
            className="flex items-center rounded-2xl border border-slate-200/60 bg-white p-1"
            style={{
              boxShadow:
                "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.06)",
            }}
          >
            <button
              onClick={() => setView("list")}
              title="List view"
              className={
                "vb-btn flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium " +
                (view === "list"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              <IconList className="h-3.5 w-3.5" />
              List
            </button>
            <button
              onClick={() => setView("cards")}
              title="Card view"
              className={
                "vb-btn flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium " +
                (view === "cards"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              <IconGrid className="h-3.5 w-3.5" />
              Cards
            </button>
          </div>
        </div>

        {/* Tag chips row */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {ALL_TAGS.map((t) => {
            const on = activeTags.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTag(t.id)}
                className={
                  "vb-btn flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs " +
                  (on
                    ? "border-transparent text-slate-900"
                    : "border-slate-200/70 bg-white text-slate-600 hover:text-slate-900")
                }
                style={on ? { backgroundColor: "rgba(110,231,183,0.20)" } : undefined}
              >
                {on && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: "#10B981" }}
                  />
                )}
                {t.name}
              </button>
            );
          })}

          {/* AND / OR inline mini-toggle */}
          <div className="ml-1 flex items-center rounded-full border border-slate-200/70 bg-white p-0.5 text-[10px] font-medium">
            <button
              onClick={() => setTagMatch("AND")}
              className={
                "vb-btn rounded-full px-2 py-1 " +
                (tagMatch === "AND"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              AND
            </button>
            <button
              onClick={() => setTagMatch("OR")}
              className={
                "vb-btn rounded-full px-2 py-1 " +
                (tagMatch === "OR"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:text-slate-800")
              }
            >
              OR
            </button>
          </div>
        </div>

        {/* Bulk action ribbon */}
        {selected.size > 0 && (
          <div
            className="mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3"
            style={{
              backgroundColor: "#ECFDF5",
              borderColor: "#A7F3D0",
            }}
          >
            <span className="text-sm font-medium text-slate-800">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="vb-btn flex items-center gap-1 rounded-full border border-slate-200/70 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:text-slate-900"
            >
              <IconX className="h-3 w-3" />
              Clear
            </button>
            <span className="mx-1 h-4 w-px bg-emerald-200/80" />
            <button
              className="vb-icon-btn group flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              title="Bulk delete"
            >
              <IconTrash className="h-4 w-4" />
            </button>
            <button
              className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 hover:text-slate-900"
              title="Add tag to selected"
            >
              <IconTag className="h-4 w-4" />
            </button>
            <button
              className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 hover:text-slate-900"
              title="Bundle selected as a share link"
            >
              <IconLink className="h-4 w-4" />
            </button>
            <span className="ml-auto text-[11px] text-emerald-700/80">
              Tip: shift-click to range-select
            </span>
          </div>
        )}

        {/* List of question cards */}
        <ul className="mt-5 flex flex-col gap-3">
          {visible.map((qq, i) => {
            const isSel = selected.has(qq.id);
            const visibleTags = qq.tags.slice(0, 3);
            const overflow = qq.tags.length - visibleTags.length;
            return (
              <li
                key={qq.id}
                className={"vb-card" + (mounted ? " is-mounted" : "")}
                style={{
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <article
                  className="flex items-start gap-4 rounded-2xl border border-slate-200/60 bg-white p-5"
                  style={{
                    boxShadow:
                      "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.06)",
                  }}
                >
                  {/* leading checkbox */}
                  <label className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelected(qq.id)}
                      className="peer sr-only"
                    />
                    <span
                      className="vb-btn flex h-[18px] w-[18px] items-center justify-center rounded-md border"
                      style={
                        isSel
                          ? {
                              backgroundColor: "#6EE7B7",
                              borderColor: "#6EE7B7",
                              color: "#0F172A",
                            }
                          : {
                              backgroundColor: "#fff",
                              borderColor: "#CBD5E1",
                              color: "transparent",
                            }
                      }
                      aria-hidden
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    </span>
                  </label>

                  {/* body */}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[15px] leading-relaxed text-slate-800">
                      {qq.stem}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {/* type pill */}
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-700"
                        style={{ backgroundColor: TYPE_TINT[qq.type] }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: TYPE_DOT[qq.type] }}
                        />
                        {qq.type}
                      </span>
                      {visibleTags.map((t) => (
                        <span
                          key={t.id}
                          className="rounded-full border border-slate-200/70 bg-white px-2 py-0.5 text-[11px] text-slate-500"
                        >
                          {t.name}
                        </span>
                      ))}
                      {overflow > 0 && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          +{overflow}
                        </span>
                      )}
                      <span className="ml-1 text-[11px] text-slate-400">
                        · {qq.updatedAt}
                      </span>
                    </div>
                  </div>

                  {/* trailing icon buttons */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      title="Edit"
                      className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full text-slate-500 opacity-50 hover:bg-slate-100 hover:text-slate-900 hover:opacity-100"
                    >
                      <IconPencil className="h-4 w-4" />
                    </button>
                    <button
                      title="Delete"
                      className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full text-slate-500 opacity-50 hover:bg-rose-50 hover:text-rose-600 hover:opacity-100"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>

        {/* Pagination */}
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {fromIdx}–{toIdx} of {total}
          </p>
          <div className="flex items-center gap-1">
            <button
              className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900"
              title="Previous page"
            >
              <IconChevLeft className="h-4 w-4" />
            </button>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                title={`Page ${n}`}
                className={
                  "vb-btn flex h-8 w-8 items-center justify-center rounded-full text-xs " +
                  (n === 1
                    ? "bg-slate-900 font-medium text-white"
                    : "text-slate-500 hover:bg-white hover:text-slate-900")
                }
              >
                {n}
              </button>
            ))}
            <button
              className="vb-icon-btn flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900"
              title="Next page"
            >
              <IconChevRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* breathing room at the bottom */}
        <div className="h-12" />
      </main>
    </div>
  );
}
