/**
 * Variant E — "Sapphire Console".
 *
 * Design intent: an IDE/terminal-inspired, keyboard-first Question Bank where
 * every action is reachable with a visible shortcut chip — sharp 2px corners,
 * monospace metadata, sapphire accent, and a signature bottom status bar.
 *
 * Icons needed (lucide-react names):
 *   - Search
 *   - Command
 *   - HelpCircle
 *   - LogOut
 *   - Library         (left-rail "Question Bank")
 *   - Plus
 *   - RefreshCw       (left-rail "Review")
 *   - Upload
 *   - Link2
 *   - Settings
 *   - Camera
 *   - Pencil
 *   - Trash2
 *   - Tag
 *   - CornerDownLeft  (Enter glyph)
 *   - X
 *   - ChevronLeft
 *   - ChevronRight
 *   - List
 *   - LayoutGrid
 *   - Circle          (online indicator)
 *
 * Preview-only — no router/api/auth. Inline SVG only (stroke 1.5,
 * currentColor, viewBox=24, square caps).
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types & mock data
// ---------------------------------------------------------------------------

type QType = "MCQ" | "FILL" | "TF";

interface MTag {
  id: string;
  name: string;
}

interface Question {
  id: string;           // human-readable id, e.g. "Q-0042"
  stem: string;
  type: QType;
  tags: MTag[];
  hiddenTags: number;   // for the "+N" overflow chip
  updated: string;      // pre-formatted mono timestamp
  selected?: boolean;
}

const ALL_TAGS: MTag[] = [
  { id: "t-alg", name: "algebra" },
  { id: "t-cal", name: "calculus" },
  { id: "t-geo", name: "geometry" },
  { id: "t-prb", name: "probability" },
  { id: "t-sta", name: "statistics" },
  { id: "t-lin", name: "linear-alg" },
  { id: "t-num", name: "number-thy" },
  { id: "t-g9", name: "grade-9" },
  { id: "t-g11", name: "grade-11" },
];

const ACTIVE_TAGS = new Set(["t-alg"]);

const QUESTIONS: Question[] = [
  {
    id: "Q-0042",
    stem: "Solve for x in the equation x^2 + 2x - 8 = 0. Which value satisfies the equation?",
    type: "MCQ",
    tags: [{ id: "t-alg", name: "algebra" }, { id: "t-g9", name: "grade-9" }],
    hiddenTags: 1,
    updated: "12 May · 14:32",
    selected: true,
  },
  {
    id: "Q-0041",
    stem: "The derivative of f(x) = sin(x)cos(x) with respect to x equals which of the following expressions?",
    type: "MCQ",
    tags: [{ id: "t-cal", name: "calculus" }],
    hiddenTags: 0,
    updated: "12 May · 13:08",
    selected: true,
  },
  {
    id: "Q-0040",
    stem: "The capital of Australia is ______.",
    type: "FILL",
    tags: [{ id: "t-geo", name: "geometry" }],
    hiddenTags: 0,
    updated: "11 May · 22:51",
  },
  {
    id: "Q-0039",
    stem: "A fair coin is tossed three times. What is the probability of getting at least two heads?",
    type: "MCQ",
    tags: [{ id: "t-prb", name: "probability" }, { id: "t-sta", name: "statistics" }],
    hiddenTags: 0,
    updated: "11 May · 18:20",
    selected: true,
  },
  {
    id: "Q-0038",
    stem: "True or False: the sum of interior angles of any triangle in Euclidean geometry equals 180°.",
    type: "TF",
    tags: [{ id: "t-geo", name: "geometry" }, { id: "t-g9", name: "grade-9" }],
    hiddenTags: 0,
    updated: "11 May · 09:12",
  },
  {
    id: "Q-0037",
    stem: "Given matrix A = [[1, 2],[3, 4]], compute the determinant det(A).",
    type: "MCQ",
    tags: [{ id: "t-lin", name: "linear-alg" }],
    hiddenTags: 2,
    updated: "10 May · 16:44",
  },
  {
    id: "Q-0036",
    stem: "Find lim_{x → 0} ( sin(x) / x ).",
    type: "MCQ",
    tags: [{ id: "t-cal", name: "calculus" }, { id: "t-g11", name: "grade-11" }],
    hiddenTags: 0,
    updated: "10 May · 11:07",
  },
  {
    id: "Q-0035",
    stem: "Which of the following is a prime factor of 360? Select all that apply.",
    type: "MCQ",
    tags: [{ id: "t-num", name: "number-thy" }],
    hiddenTags: 1,
    updated: "09 May · 21:39",
  },
];

const SELECTED_COUNT = QUESTIONS.filter((q) => q.selected).length;

// ---------------------------------------------------------------------------
// Inline icons (stroke 1.5, currentColor, viewBox=24, square caps)
// ---------------------------------------------------------------------------

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
};

function Svg({ size = 16, children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      {...baseProps}
    >
      {children}
    </svg>
  );
}

const I = {
  Search: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Svg>
  ),
  Command: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 6h6v12H9z" />
      <path d="M6 6V3h3v3M18 6V3h-3v3M6 18v3h3v-3M18 18v3h-3v-3" />
    </Svg>
  ),
  Help: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17h.01" />
    </Svg>
  ),
  LogOut: (p: IconProps) => (
    <Svg {...p}>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4M6 12h11" />
    </Svg>
  ),
  Library: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4h3v16H4zM10 4h3v16h-3zM17 5l3 1-4 14-3-1z" />
    </Svg>
  ),
  Plus: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Refresh: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5" />
    </Svg>
  ),
  Upload: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 4v12M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </Svg>
  ),
  Link: (p: IconProps) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 10-5.66-5.66L11.5 7" />
      <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 105.66 5.66L12.5 17" />
    </Svg>
  ),
  Settings: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.4 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.4 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.4-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.4-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.4H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.4l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.4 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </Svg>
  ),
  Camera: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 7h4l2-3h6l2 3h4v12H3z" />
      <circle cx="12" cy="13" r="4" />
    </Svg>
  ),
  Pencil: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </Svg>
  ),
  Trash: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h16" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3M10 11v6M14 11v6" />
    </Svg>
  ),
  Tag: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 12V3h9l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </Svg>
  ),
  Enter: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20 5v6a3 3 0 01-3 3H5" />
      <path d="M9 10l-4 4 4 4" />
    </Svg>
  ),
  X: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  ChevL: (p: IconProps) => (
    <Svg {...p}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  ),
  ChevR: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  ),
  List: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  ),
  Grid: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </Svg>
  ),
  Dot: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Svg>
  ),
};

// ---------------------------------------------------------------------------
// Small reusable atoms
// ---------------------------------------------------------------------------

// Keyboard-hint chip. Mono, sharp 2px corners.
function Key({
  children,
  tone = "default",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "default" | "onDark";
  className?: string;
}) {
  const cls =
    tone === "onDark"
      ? "border-white/30 bg-white/10 text-white"
      : "border-[#E2E8F0] bg-white text-[#475569]";
  return (
    <span
      className={
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] border px-[5px] font-mono text-[10px] leading-none " +
        cls +
        " " +
        className
      }
      style={{ fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace" }}
    >
      {children}
    </span>
  );
}

// Square mono badge (TYPE column / inactive tag).
function MonoChip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "active";
}) {
  const cls =
    tone === "active"
      ? "border-[#0B3B8C]/15 bg-[#DBEAFE] text-[#0B3B8C]"
      : "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]";
  return (
    <span
      className={
        "inline-flex h-[20px] items-center rounded-[2px] border px-[6px] font-mono text-[10.5px] tracking-tight " +
        cls
      }
      style={{ fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace" }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Left rail item
// ---------------------------------------------------------------------------

function RailButton({
  icon,
  letter,
  active,
  label,
}: {
  icon: React.ReactNode;
  letter?: string;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label + (letter ? ` (${letter})` : "")}
      className={
        "group relative flex h-10 w-10 items-center justify-center rounded-[4px] border transition-colors duration-120 " +
        (active
          ? "border-transparent bg-[#1E3A8A] text-white"
          : "border-transparent text-[#475569] hover:bg-[#EFF6FF] hover:ring-1 hover:ring-[#1E3A8A]/60 hover:text-[#0B3B8C]")
      }
    >
      {icon}
      {letter ? (
        <span
          className={
            "pointer-events-none absolute bottom-[2px] right-[2px] font-mono text-[9px] leading-none " +
            (active ? "text-white/80" : "text-[#94A3B8] group-hover:text-[#0B3B8C]")
          }
          style={{
            fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
          }}
        >
          {letter}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function QuestionBankVariantE() {
  const [view, setView] = useState<"list" | "cards">("list");
  const [tagMatch, setTagMatch] = useState<"AND" | "OR">("AND");
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger the staggered row fade-in once after first paint.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Memoized to keep the JSX tidy — the visible items always come from the
  // same mock array in this preview, but a real page would slice by offset.
  const items = useMemo(() => QUESTIONS, []);

  // The mono prompt query string is rendered as token spans below.
  // Keeping the tokens in one place keeps the visual aligned.
  return (
    <div
      className="relative min-h-dvh w-full bg-white text-[#0F172A]"
      style={{
        fontFamily: "ui-sans-serif, Inter, system-ui, sans-serif",
      }}
    >
      {/* Reduced-motion + keyframes (caret blink, row fade-in, CRT sweep). */}
      <style>{`
        @keyframes qbe-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        @keyframes qbe-rowin { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes qbe-sweep { 0% { transform: translateY(0); } 100% { transform: translateY(100vh); } }
        .qbe-caret { animation: qbe-blink 1.05s steps(2, end) infinite; }
        .qbe-row { animation: qbe-rowin 220ms ease-out both; }
        .qbe-sweep { animation: qbe-sweep 18s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .qbe-caret, .qbe-row, .qbe-sweep { animation: none !important; }
        }
      `}</style>

      {/* Vertical guide-pattern background (96px columns, sapphire-100 @ 6%) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(11,59,140,0.06) 1px, transparent 1px)",
          backgroundSize: "96px 100%",
          backgroundPosition: "0 0",
        }}
      />

      {/* CRT sweep — single thin sapphire-400 line, slowly descending */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-screen overflow-hidden"
      >
        <div
          className="qbe-sweep absolute inset-x-0 h-px"
          style={{ backgroundColor: "rgba(96,165,250,0.06)" }}
        />
      </div>

      {/* =====================================================================
          TOP HEADER / "TAB BAR"
          ===================================================================== */}
      <header
        className="sticky top-0 z-40 flex h-[52px] items-stretch border-b border-[#E2E8F0] bg-white/95 backdrop-blur"
      >
        {/* Brand block */}
        <div className="flex items-center gap-2 border-r border-[#E2E8F0] pl-4 pr-5">
          <img
            src="/fastqb-logo.png"
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 rounded-sm"
          />
          <span className="text-[14px] font-semibold tracking-tight text-[#0A2540]">
            FastQBank
          </span>
          <span
            className="ml-1 rounded-[2px] border border-[#E2E8F0] bg-[#F8FAFC] px-[5px] py-[1px] font-mono text-[10px] text-[#475569]"
            style={{
              fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
            }}
          >
            v0.9.0
          </span>
        </div>

        {/* IDE-style tab strip */}
        <nav className="flex items-stretch">
          {[
            { label: "Question Bank", active: true },
            { label: "New", active: false },
            { label: "Review", active: false },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              className={
                "relative flex items-center border-r border-[#E2E8F0] px-4 text-[12.5px] transition-colors duration-120 " +
                (t.active
                  ? "bg-[#F8FAFC] text-[#0A2540]"
                  : "bg-white text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0A2540]")
              }
              style={{ fontFamily: "ui-sans-serif, Inter, system-ui" }}
            >
              {t.active ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{ backgroundColor: "#1E3A8A" }}
                />
              ) : null}
              <span className={t.active ? "font-medium" : ""}>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Right cluster: command bar + help + avatar + logout */}
        <div className="ml-auto flex items-center gap-2 pr-4">
          <button
            type="button"
            className="group flex h-9 w-[260px] items-center gap-2 rounded-[2px] border border-[#E2E8F0] bg-[#F8FAFC] px-2 text-left transition-colors duration-120 hover:border-[#2563EB]"
          >
            <I.Search size={14} className="text-[#94A3B8] group-hover:text-[#0B3B8C]" />
            <span
              className="flex-1 truncate font-mono text-[11.5px] text-[#94A3B8]"
              style={{
                fontFamily: "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              Search or ⌘K to open command palette
            </span>
            <Key>⌘ K</Key>
          </button>

          <button
            type="button"
            aria-label="Help"
            className="flex h-9 w-9 items-center justify-center rounded-[2px] border border-transparent text-[#475569] hover:border-[#E2E8F0] hover:bg-[#F8FAFC]"
          >
            <I.Help size={16} />
          </button>

          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#DBEAFE] text-[11px] font-semibold text-[#0B3B8C]">
            JW
          </div>

          <button
            type="button"
            aria-label="Log out"
            className="flex h-9 w-9 items-center justify-center rounded-[2px] border border-transparent text-[#475569] hover:border-[#E2E8F0] hover:bg-[#F8FAFC]"
          >
            <I.LogOut size={16} />
          </button>
        </div>
      </header>

      {/* =====================================================================
          BODY = left rail + main pane (reserve room for sticky 28px status bar)
          ===================================================================== */}
      <div className="relative flex" style={{ minHeight: "calc(100dvh - 52px - 28px)" }}>
        {/* ---- LEFT RAIL ------------------------------------------------- */}
        <aside
          className="sticky top-[52px] z-30 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-[#E2E8F0] bg-[#F8FAFC] py-3"
          style={{ height: "calc(100dvh - 52px - 28px)" }}
        >
          <RailButton
            label="Question Bank"
            letter="1"
            active
            icon={<I.Library size={18} />}
          />
          <RailButton label="New" letter="2" icon={<I.Plus size={18} />} />
          <RailButton label="Review" letter="3" icon={<I.Refresh size={18} />} />
          <RailButton label="Imports" letter="4" icon={<I.Upload size={18} />} />
          <RailButton label="My shares" letter="5" icon={<I.Link size={18} />} />

          <div className="my-2 h-px w-7 bg-[#E2E8F0]" />

          <RailButton label="Settings" letter="," icon={<I.Settings size={18} />} />
          <RailButton label="Help" letter="?" icon={<I.Help size={18} />} />
        </aside>

        {/* ---- MAIN PANE ------------------------------------------------- */}
        <main className="relative min-w-0 flex-1 px-8 py-6">
          {/* ----- Page header ---------------------------------------- */}
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div
                className="font-mono text-[11px] text-[#94A3B8]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                ~/fastqbank/questions
              </div>
              <h1
                className="mt-1 text-[26px] font-semibold tracking-tight text-[#0A2540]"
                style={{ fontFamily: "ui-sans-serif, Inter, system-ui" }}
              >
                Question bank
              </h1>
              <div
                className="mt-1 font-mono text-[11.5px] text-[#475569]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                87 results · 12 tagged ·{" "}
                <span className="text-[#94A3B8]">⌘F to search</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Icon-only ghost buttons with keyboard hint chips */}
              {[
                { label: "OCR capture", letter: "O", icon: <I.Camera size={16} /> },
                { label: "Import", letter: "I", icon: <I.Upload size={16} /> },
                { label: "My shares", letter: "S", icon: <I.Link size={16} /> },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  title={b.label}
                  className="group relative flex h-9 w-9 items-center justify-center rounded-[2px] border border-[#E2E8F0] bg-white text-[#475569] transition-colors duration-120 hover:border-[#2563EB] hover:text-[#0B3B8C]"
                >
                  {b.icon}
                  <span
                    className="absolute bottom-[1px] right-[1px] font-mono text-[9px] text-[#94A3B8] group-hover:text-[#0B3B8C]"
                    style={{
                      fontFamily:
                        "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                    }}
                  >
                    {b.letter}
                  </span>
                </button>
              ))}

              {/* Primary CTA */}
              <button
                type="button"
                className="flex h-9 items-center gap-2 rounded-[2px] border border-[#1E3A8A] bg-[#1E3A8A] px-3 text-[12.5px] font-medium text-white transition-colors duration-120 hover:bg-[#0B3B8C]"
                style={{ fontFamily: "ui-sans-serif, Inter, system-ui" }}
              >
                <I.Plus size={14} />
                <span className="tracking-wide uppercase">New question</span>
                <Key tone="onDark" className="ml-1">N</Key>
              </button>
            </div>
          </div>

          {/* ----- Filter "command line" ------------------------------ */}
          <div
            className="mt-5 flex items-stretch gap-2 rounded-[2px] border border-[#E2E8F0] bg-white"
            style={{ borderColor: "#E2E8F0" }}
          >
            {/* Command input */}
            <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
              <span
                className="select-none font-mono text-[13px] font-medium text-[#2563EB]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                ›
              </span>
              {/* Caret + tokenized "input" — purely visual. */}
              <div
                className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[12.5px]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                <span
                  aria-hidden
                  className="qbe-caret -ml-1 inline-block h-[15px] w-[7px]"
                  style={{ backgroundColor: "#60A5FA" }}
                />
                <span className="text-[#0B3B8C]">tag:</span>
                <span className="text-[#0F172A]">algebra</span>
                <span className="text-[#94A3B8]">·</span>
                <span className="text-[#0B3B8C]">type:</span>
                <span className="text-[#0F172A]">MCQ</span>
                <span className="text-[#94A3B8]">·</span>
                <span className="text-[#475569]">"limits"</span>
              </div>
              <Key className="shrink-0">⌘F</Key>
            </div>

            {/* Divider + Clear + View toggle */}
            <div className="flex items-stretch">
              <div className="w-px self-stretch bg-[#E2E8F0]" />
              <button
                type="button"
                className="flex items-center gap-1 px-3 text-[11.5px] font-medium text-[#475569] transition-colors duration-120 hover:bg-[#F8FAFC] hover:text-[#0B3B8C]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                <I.X size={12} />
                CLEAR
              </button>
              <div className="w-px self-stretch bg-[#E2E8F0]" />
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={
                    "flex w-9 items-center justify-center transition-colors duration-120 " +
                    (view === "list"
                      ? "bg-[#1E3A8A] text-white"
                      : "text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0B3B8C]")
                  }
                  aria-label="List view"
                >
                  <I.List size={14} />
                </button>
                <div className="w-px self-stretch bg-[#E2E8F0]" />
                <button
                  type="button"
                  onClick={() => setView("cards")}
                  className={
                    "flex w-9 items-center justify-center transition-colors duration-120 " +
                    (view === "cards"
                      ? "bg-[#1E3A8A] text-white"
                      : "text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0B3B8C]")
                  }
                  aria-label="Card view"
                >
                  <I.Grid size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* ----- Tag filter strip ----------------------------------- */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {ALL_TAGS.map((t) => {
              const active = ACTIVE_TAGS.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={
                    "inline-flex h-[24px] items-center rounded-[2px] border px-2 font-mono text-[11px] tracking-tight transition-colors duration-120 " +
                    (active
                      ? "border-[#0B3B8C]/15 bg-[#DBEAFE] text-[#0B3B8C]"
                      : "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569] hover:bg-[#EFF6FF] hover:text-[#0B3B8C]")
                  }
                  style={{
                    fontFamily:
                      "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                  }}
                >
                  {active ? "# " : ""}
                  {t.name}
                  {active ? (
                    <I.X size={11} className="ml-1 text-[#0B3B8C]/70" />
                  ) : null}
                </button>
              );
            })}

            {/* AND / OR toggle */}
            <div
              className="ml-2 inline-flex h-[24px] items-stretch overflow-hidden rounded-[2px] border border-[#E2E8F0]"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              {(["AND", "OR"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTagMatch(m)}
                  className={
                    "flex items-center px-2 text-[10.5px] font-medium transition-colors duration-120 " +
                    (tagMatch === m
                      ? "bg-[#1E3A8A] text-white"
                      : "bg-white text-[#475569] hover:bg-[#F8FAFC]")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* ----- Bulk action bar ------------------------------------ */}
          <div className="mt-4 flex items-center gap-2 rounded-[2px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
            <span
              className="font-mono text-[11.5px] font-semibold text-[#1E3A8A]"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              [{SELECTED_COUNT} SELECTED]
            </span>

            <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />

            {/* Bulk delete (red on hover only) */}
            <button
              type="button"
              title="Bulk delete"
              className="group relative flex h-8 items-center gap-1.5 rounded-[2px] border border-[#E2E8F0] bg-white px-2 text-[#475569] transition-colors duration-120 hover:border-[#DC2626] hover:text-[#DC2626]"
            >
              <I.Trash size={14} />
              <Key>⌫</Key>
            </button>

            <button
              type="button"
              title="Add tag"
              className="group flex h-8 items-center gap-1.5 rounded-[2px] border border-[#E2E8F0] bg-white px-2 text-[#475569] transition-colors duration-120 hover:border-[#2563EB] hover:text-[#0B3B8C]"
            >
              <I.Tag size={14} />
              <Key>T</Key>
            </button>

            <button
              type="button"
              title="Bundle as link"
              className="group flex h-8 items-center gap-1.5 rounded-[2px] border border-[#E2E8F0] bg-white px-2 text-[#475569] transition-colors duration-120 hover:border-[#2563EB] hover:text-[#0B3B8C]"
            >
              <I.Link size={14} />
              <Key>B</Key>
            </button>

            <span
              className="ml-auto font-mono text-[10.5px] text-[#94A3B8]"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              Esc to clear
            </span>
          </div>

          {/* ----- Table list ----------------------------------------- */}
          <div className="mt-3 overflow-hidden rounded-[2px] border border-[#E2E8F0] bg-white">
            {/* Sticky mono header */}
            <div
              className="grid items-center gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 font-mono text-[10.5px] uppercase tracking-wider text-[#94A3B8]"
              style={{
                gridTemplateColumns:
                  "28px 44px 78px minmax(0, 1fr) 60px 200px 110px 56px",
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              <span aria-hidden />
              <span>IDX</span>
              <span>ID</span>
              <span>STEM</span>
              <span>TYPE</span>
              <span>TAGS</span>
              <span>UPDATED</span>
              <span className="text-right">&nbsp;</span>
            </div>

            {/* Rows */}
            <ul className="divide-y divide-[#E2E8F0]">
              {items.map((q, i) => {
                const isHover = hoverRow === q.id;
                const idx = String(i + 1).padStart(4, "0");
                return (
                  <li
                    key={q.id}
                    onMouseEnter={() => setHoverRow(q.id)}
                    onMouseLeave={() =>
                      setHoverRow((cur) => (cur === q.id ? null : cur))
                    }
                    className="qbe-row relative grid items-center gap-3 px-3 py-2.5 transition-colors duration-120"
                    style={{
                      gridTemplateColumns:
                        "28px 44px 78px minmax(0, 1fr) 60px 200px 110px 56px",
                      backgroundColor: isHover ? "#EFF6FF" : "transparent",
                      animationDelay: mounted ? "0ms" : `${i * 10}ms`,
                    }}
                  >
                    {/* Left active-bar on hover */}
                    {isHover ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[2px]"
                        style={{ backgroundColor: "#1E3A8A" }}
                      />
                    ) : null}

                    {/* Checkbox cell */}
                    <span className="flex h-4 w-4 items-center justify-center">
                      <input
                        type="checkbox"
                        defaultChecked={q.selected}
                        aria-label={`Select ${q.id}`}
                        className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-[2px] border border-[#94A3B8] checked:border-[#1E3A8A] checked:bg-[#1E3A8A]"
                        style={{
                          backgroundImage: q.selected
                            ? "linear-gradient(45deg, transparent 35%, #fff 35%, #fff 45%, transparent 45%, transparent 55%, #fff 55%, #fff 65%, transparent 65%)"
                            : undefined,
                        }}
                      />
                    </span>

                    {/* Gutter line-number */}
                    <span
                      className={
                        "font-mono text-[11px] tabular-nums " +
                        (isHover ? "text-[#0B3B8C]" : "text-[#94A3B8]")
                      }
                      style={{
                        fontFamily:
                          "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                      }}
                    >
                      {idx}
                    </span>

                    {/* ID */}
                    <span
                      className="font-mono text-[11.5px] font-medium text-[#0B3B8C]"
                      style={{
                        fontFamily:
                          "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                      }}
                    >
                      {q.id}
                    </span>

                    {/* Stem */}
                    <span
                      className="truncate text-[13px] text-[#0F172A]"
                      style={{ fontFamily: "ui-sans-serif, Inter, system-ui" }}
                    >
                      {q.stem}
                    </span>

                    {/* Type */}
                    <span>
                      <MonoChip>{q.type}</MonoChip>
                    </span>

                    {/* Tags */}
                    <span className="flex min-w-0 items-center gap-1">
                      {q.tags.slice(0, 2).map((t) => (
                        <MonoChip key={t.id} tone="active">
                          {t.name}
                        </MonoChip>
                      ))}
                      {q.hiddenTags > 0 ? (
                        <span
                          className="font-mono text-[10.5px] text-[#94A3B8]"
                          style={{
                            fontFamily:
                              "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                          }}
                        >
                          +{q.hiddenTags}
                        </span>
                      ) : null}
                    </span>

                    {/* Updated */}
                    <span
                      className="font-mono text-[11px] text-[#475569]"
                      style={{
                        fontFamily:
                          "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                      }}
                    >
                      {q.updated}
                    </span>

                    {/* Trailing actions (visible on hover) */}
                    <span
                      className="flex items-center justify-end gap-1 transition-opacity duration-120"
                      style={{ opacity: isHover ? 1 : 0 }}
                    >
                      {/* Enter hint */}
                      <span
                        className="mr-1 inline-flex items-center text-[#94A3B8]"
                        title="Enter edits this row"
                      >
                        <I.Enter size={12} />
                      </span>
                      <button
                        type="button"
                        title="Edit"
                        className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-[#E2E8F0] bg-white text-[#475569] hover:border-[#2563EB] hover:text-[#0B3B8C]"
                      >
                        <I.Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-[#E2E8F0] bg-white text-[#475569] hover:border-[#DC2626] hover:text-[#DC2626]"
                      >
                        <I.Trash size={12} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ----- Pagination ----------------------------------------- */}
          <div className="mt-4 flex items-center justify-between">
            <span
              className="font-mono text-[11.5px] text-[#475569]"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
              }}
            >
              Page 1/9 — showing 1..10 of 87
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="group flex h-8 items-center gap-1.5 rounded-[2px] border border-[#E2E8F0] bg-white px-2.5 text-[12px] text-[#475569] hover:border-[#2563EB] hover:text-[#0B3B8C]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                <I.ChevL size={13} />
                Prev
                <Key>H</Key>
              </button>
              <button
                type="button"
                className="group flex h-8 items-center gap-1.5 rounded-[2px] border border-[#E2E8F0] bg-white px-2.5 text-[12px] text-[#475569] hover:border-[#2563EB] hover:text-[#0B3B8C]"
                style={{
                  fontFamily:
                    "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
                }}
              >
                Next
                <I.ChevR size={13} />
                <Key>L</Key>
              </button>
            </div>
          </div>

          {/* leave some breathing room above the status bar */}
          <div className="h-6" />
        </main>
      </div>

      {/* =====================================================================
          BOTTOM STATUS BAR — the signature element
          ===================================================================== */}
      <footer
        className="sticky bottom-0 z-40 flex h-7 items-center justify-between px-4 text-white"
        style={{
          backgroundColor: "#1E3A8A",
          fontFamily:
            "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace",
          fontSize: "11px",
        }}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="font-semibold tracking-wider">READY</span>
          <span className="text-white/40">·</span>
          <span>87 records</span>
          <span className="text-white/40">·</span>
          <span>selection: {SELECTED_COUNT}</span>
          <span className="text-white/40">·</span>
          <span className="text-white/80">⌘K palette</span>
          <span className="text-white/40">·</span>
          <span className="text-white/80">↵ open</span>
          <span className="text-white/40">·</span>
          <span className="text-white/80">⌫ delete</span>
          <span className="text-white/40">·</span>
          <span className="text-white/70">last sync 12:04:55</span>
        </span>

        <span className="flex items-center gap-1.5 pl-2">
          <I.Dot size={8} className="text-[#60A5FA]" />
          <span className="tracking-wider">ONLINE</span>
        </span>
      </footer>
    </div>
  );
}
