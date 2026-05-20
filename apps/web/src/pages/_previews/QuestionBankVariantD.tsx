/**
 * Variant D — "Sapphire Blueprint"
 * Design intent: a precise CAD / engineering blueprint canvas — drafted hairlines,
 * ruled grid, mono metadata, and corner-bracket selection marquees on hover.
 *
 * Icons needed (lucide-react names):
 *  - Search
 *  - Command
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
 *  - Circle       (status dot)
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirrors the real QuestionListOut shape — kept minimal for the preview)
// ---------------------------------------------------------------------------

type QuestionType = "MCQ" | "FILLBLANK" | "TRUEFALSE";

interface TagLite {
  id: string;
  name: string;
}

interface Question {
  id: string;        // display id like "Q-0042"
  stem: string;
  type: QuestionType;
  tags: TagLite[];
  updatedAt: string; // mono-formatted: "12 May · 14:32"
}

// ---------------------------------------------------------------------------
// Inline SVG icons (stroke 1.5, currentColor, sharp square ends)
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
    updatedAt: "18 May · 14:22",
  },
  {
    id: "Q-0041",
    stem: "The derivative of sin(x) with respect to x equals ____ — fill in the blank.",
    type: "FILLBLANK",
    tags: [{ id: "t-calc", name: "Calculus" }],
    updatedAt: "18 May · 11:07",
  },
  {
    id: "Q-0044",
    stem: "TCP guarantees in-order delivery of bytes between two endpoints. True or false?",
    type: "TRUEFALSE",
    tags: [
      { id: "t-net", name: "Networking" },
      { id: "t-os", name: "OS" },
      { id: "t-2024", name: "2024 set" },
    ],
    updatedAt: "17 May · 22:51",
  },
  {
    id: "Q-0039",
    stem: "Let A be an n×n matrix. Which of these statements is equivalent to A being invertible?",
    type: "MCQ",
    tags: [{ id: "t-linalg", name: "Linear algebra" }],
    updatedAt: "17 May · 19:34",
  },
  {
    id: "Q-0038",
    stem: "A fair six-sided die is rolled twice. The probability that the sum is exactly 7 is ____.",
    type: "FILLBLANK",
    tags: [
      { id: "t-prob", name: "Probability" },
      { id: "t-stats", name: "Statistics" },
    ],
    updatedAt: "17 May · 09:12",
  },
  {
    id: "Q-0037",
    stem: "In a binary heap, the parent of the node at index i is at index floor((i-1)/2). True or false?",
    type: "TRUEFALSE",
    tags: [{ id: "t-ds", name: "Data structures" }],
    updatedAt: "16 May · 23:48",
  },
  {
    id: "Q-0050",
    stem: "Which integration technique is most appropriate for evaluating the integral of x·e^x dx?",
    type: "MCQ",
    tags: [
      { id: "t-calc", name: "Calculus" },
      { id: "t-mock", name: "Mock exam" },
    ],
    updatedAt: "16 May · 17:05",
  },
  {
    id: "Q-0035",
    stem: "The sum of the interior angles of a convex polygon with n sides equals ____ degrees.",
    type: "FILLBLANK",
    tags: [
      { id: "t-geom", name: "Geometry" },
      { id: "t-discrete", name: "Discrete" },
      { id: "t-2024", name: "2024 set" },
      { id: "t-mock", name: "Mock exam" },
    ],
    updatedAt: "16 May · 12:30",
  },
];

const TOTAL = 87;
const PAGE_FROM = 1;
const PAGE_TO = 10;
const PAGE_CURRENT = 1;
const PAGE_LAST = 9;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionBankVariantD() {
  // Preselect 3 rows to demonstrate the bulk-action ribbon.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["Q-0041", "Q-0044", "Q-0050"]),
  );
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

  // Blueprint dot-grid pattern background.
  const pageBg: React.CSSProperties = {
    backgroundColor: "#FFFFFF",
    backgroundImage:
      "radial-gradient(circle, #0B3B8C 0.5px, transparent 0.6px)",
    backgroundSize: "24px 24px",
    backgroundPosition: "0 0",
    opacity: 1,
  };

  // Selected ID preview (for the bulk ribbon right side).
  const selectedIdPreview = [...selected].slice(0, 3).join(" · ");

  return (
    <div
      className="relative min-h-dvh w-full text-[#0F172A] antialiased"
      style={{
        fontFamily:
          'ui-sans-serif, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        letterSpacing: "-0.005em",
      }}
    >
      {/* Inline keyframes + style helpers. */}
      <style>{`
        .vd-mono { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-feature-settings: "tnum" 1; }
        .vd-eyebrow { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: 0.18em; }

        @keyframes vd-scan {
          0%   { transform: translateY(0); }
          100% { transform: translateY(100vh); }
        }
        @keyframes vd-driftA {
          0%   { transform: translate( 0vw,  0vh) rotate(0deg); }
          50%  { transform: translate(40vw, 30vh) rotate(180deg); }
          100% { transform: translate( 0vw,  0vh) rotate(360deg); }
        }
        @keyframes vd-driftB {
          0%   { transform: translate(50vw,  5vh) rotate(0deg); }
          50%  { transform: translate(10vw, 60vh) rotate(-180deg); }
          100% { transform: translate(50vw,  5vh) rotate(-360deg); }
        }
        @keyframes vd-driftC {
          0%   { transform: translate(80vw, 70vh) rotate(0deg); }
          50%  { transform: translate(20vw, 10vh) rotate(180deg); }
          100% { transform: translate(80vw, 70vh) rotate(360deg); }
        }
        @keyframes vd-bracketIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .vd-row { position: relative; }
        .vd-row .vd-row-bar {
          position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
          background: #1E40AF;
          transform: scaleY(0); transform-origin: center;
          transition: transform 140ms ease-out;
        }
        .vd-row:hover { background: #EFF6FF; }
        .vd-row:hover .vd-row-bar { transform: scaleY(1); }
        .vd-row:hover .vd-row-actions { opacity: 1; }
        .vd-row-actions { opacity: 0.3; transition: opacity 140ms ease-out; }

        .vd-bracket {
          position: absolute; width: 8px; height: 8px;
          opacity: 0;
        }
        .vd-row:hover .vd-bracket { animation: vd-bracketIn 120ms ease-out forwards; }
        .vd-row:hover .vd-bracket.vd-b-tl { animation-delay: 0ms; }
        .vd-row:hover .vd-bracket.vd-b-tr { animation-delay: 15ms; }
        .vd-row:hover .vd-bracket.vd-b-bl { animation-delay: 30ms; }
        .vd-row:hover .vd-bracket.vd-b-br { animation-delay: 45ms; }
        .vd-bracket.vd-b-tl { top: 0;    left: 0;    border-top: 1.5px solid #1E40AF; border-left: 1.5px solid #1E40AF; }
        .vd-bracket.vd-b-tr { top: 0;    right: 0;   border-top: 1.5px solid #1E40AF; border-right: 1.5px solid #1E40AF; }
        .vd-bracket.vd-b-bl { bottom: 0; left: 0;    border-bottom: 1.5px solid #1E40AF; border-left: 1.5px solid #1E40AF; }
        .vd-bracket.vd-b-br { bottom: 0; right: 0;   border-bottom: 1.5px solid #1E40AF; border-right: 1.5px solid #1E40AF; }

        .vd-scanline { animation: vd-scan 12s linear infinite; }
        .vd-particleA { animation: vd-driftA 38s linear infinite; }
        .vd-particleB { animation: vd-driftB 47s linear infinite; }
        .vd-particleC { animation: vd-driftC 33s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .vd-scanline,
          .vd-particleA,
          .vd-particleB,
          .vd-particleC { animation: none !important; }
          .vd-row:hover .vd-bracket { animation: none !important; opacity: 1; }
        }
      `}</style>

      {/* Background blueprint grid */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={pageBg} aria-hidden />
      {/* Reduce grid intensity to the target 0.18 by overlaying a near-white veil */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        aria-hidden
        style={{ background: "rgba(255,255,255,0.82)" }}
      />

      {/* Scan line + particles overlay (z-0 so content above interacts normally) */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        {/* Horizontal scan line */}
        <div
          className={reducedMotion ? "" : "vd-scanline"}
          style={{
            position: "absolute",
            top: "-2px",
            left: 0,
            right: 0,
            height: "1px",
            background: "#3B82F6",
            opacity: 0.1,
          }}
        />

        {/* Drifting particles (group A) */}
        <div className={reducedMotion ? "" : "vd-particleA"} style={particlePos(8, 12)}>
          <Particle kind="square" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleA"} style={particlePos(60, 18)}>
          <Particle kind="plus" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleB"} style={particlePos(30, 40)}>
          <Particle kind="circle" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleB"} style={particlePos(75, 70)}>
          <Particle kind="square" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleC"} style={particlePos(15, 80)}>
          <Particle kind="plus" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleC"} style={particlePos(85, 25)}>
          <Particle kind="circle" />
        </div>
        <div className={reducedMotion ? "" : "vd-particleA"} style={particlePos(45, 88)}>
          <Particle kind="square" />
        </div>
      </div>

      {/* =========================== Header =========================== */}
      <header className="sticky top-0 z-30 h-[56px] w-full border-b border-[#DBEAFE] bg-white">
        <div className="mx-auto flex h-full max-w-[1280px] items-center gap-6 px-6">
          {/* Logo + wordmark + build tag */}
          <a href="#" className="flex items-center gap-2.5">
            <img
              src="/fastqb-logo.png"
              alt="FastQBank"
              className="h-[22px] w-[22px] rounded"
              style={{ borderRadius: 2 }}
            />
            <span className="text-[15px] font-semibold tracking-tight text-[#0A2540]">
              FastQBank
            </span>
            <span className="vd-mono ml-1 text-[10.5px] text-[#94A3B8]">
              v0.9.0 · build a3f1
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
                  onClick={() =>
                    setActiveTab(item.k as typeof activeTab)
                  }
                  className="relative px-3 py-1.5"
                  style={{
                    color: active ? "#1E40AF" : "#475569",
                    transition: "color 150ms ease-out",
                  }}
                >
                  {active ? (
                    <span>
                      <span className="text-[#1E40AF]">[ </span>
                      {item.label}
                      <span className="text-[#1E40AF]"> ]</span>
                    </span>
                  ) : (
                    item.label
                  )}
                  {active && (
                    <span
                      className="absolute inset-x-3 -bottom-[15px] h-[2px]"
                      style={{ background: "#1E40AF" }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* ⌘ K chip */}
            <span
              className="vd-mono flex h-7 items-center gap-1 px-2 text-[11px] text-[#475569]"
              style={{ border: "1px solid #DBEAFE", borderRadius: 2 }}
            >
              <IconCommand className="h-3 w-3" />K
            </span>
            {/* STATUS pill */}
            <span
              className="vd-mono flex h-7 items-center gap-1.5 px-2 text-[10.5px]"
              style={{ border: "1px solid #DBEAFE", borderRadius: 2 }}
            >
              <span
                className="inline-block h-1.5 w-1.5"
                style={{ background: "#1E40AF", borderRadius: 1 }}
              />
              <span className="text-[#94A3B8]">STATUS ·</span>
              <span className="text-[#1E40AF]">ONLINE</span>
            </span>
            {/* Avatar */}
            <div
              title="Jasper W."
              className="flex h-7 w-7 items-center justify-center text-[11px] font-medium text-white"
              style={{ background: "#0A2540", borderRadius: 999 }}
            >
              JW
            </div>
            <button
              title="Log out"
              className="flex h-7 w-7 items-center justify-center text-[#475569] hover:text-[#0A2540]"
              style={{ borderRadius: 2, transition: "color 150ms ease-out" }}
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* =========================== Main =========================== */}
      <main className="relative z-10 mx-auto max-w-[1280px] px-6 pt-6 pb-24">
        {/* ---- Title block ---- */}
        <section>
          <div className="h-px w-full" style={{ background: "#DBEAFE" }} />
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="vd-eyebrow text-[10.5px] text-[#475569]">
                Question Bank
              </p>
              <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-[#0A2540]">
                All questions
              </h1>
              <p className="vd-mono mt-1.5 text-[12px] text-[#475569]">
                <span className="text-[#0A2540]">87 records</span>
                <span className="text-[#94A3B8]"> · </span>
                12 tagged
                <span className="text-[#94A3B8]"> · </span>
                updated 2 min ago
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <ToolIconButton title="OCR capture">
                <IconCamera />
              </ToolIconButton>
              <ToolIconButton title="Import">
                <IconUpload />
              </ToolIconButton>
              <ToolIconButton title="My shares">
                <IconLink />
              </ToolIconButton>

              <span
                className="mx-1.5 h-5 w-px"
                style={{ background: "#DBEAFE" }}
              />

              {/* Primary CTA */}
              <button
                className="vd-eyebrow flex h-9 items-center gap-2 px-3 text-[11.5px] font-medium text-white"
                style={{
                  background: "#1E40AF",
                  borderRadius: 4,
                  boxShadow: "inset 0 0 0 1px #0A2540",
                  transition: "background-color 150ms ease-out",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#0B3B8C")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#1E40AF")
                }
              >
                <IconPlus className="h-3.5 w-3.5" />
                New question
                <span
                  className="vd-mono ml-1 flex h-[18px] min-w-[18px] items-center justify-center px-1 text-[10px] font-normal leading-none text-white"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.32)",
                    borderRadius: 2,
                    letterSpacing: 0,
                  }}
                >
                  N
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* ---- Filter bar panel ---- */}
        <section
          className="mt-5 flex items-center gap-2 p-2"
          style={{ border: "1px solid #DBEAFE", borderRadius: 2 }}
        >
          {/* Search */}
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              placeholder="Search stem…"
              className="vd-mono h-9 w-[420px] pl-8 pr-16 text-[12.5px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none"
              style={{
                border: "1px solid #DBEAFE",
                borderRadius: 4,
                background: "#FFFFFF",
                transition: "border-color 150ms ease-out, box-shadow 150ms ease-out",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#1E40AF";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(30,64,175,0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#DBEAFE";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <span
              className="vd-mono pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 px-1.5 py-[2px] text-[10px] text-[#475569]"
              style={{
                background: "#F8FAFC",
                border: "1px solid #DBEAFE",
                borderRadius: 2,
              }}
            >
              <IconCommand className="h-2.5 w-2.5" />K
            </span>
          </div>

          <button
            className="flex h-9 items-center gap-1.5 px-3 text-[12px] text-[#475569]"
            style={{
              borderRadius: 4,
              transition: "background-color 150ms ease-out, color 150ms ease-out",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#EFF6FF";
              e.currentTarget.style.color = "#0A2540";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#475569";
            }}
          >
            <IconX className="h-3.5 w-3.5" />
            Clear
          </button>

          {/* Segmented List / Cards */}
          <div
            className="ml-auto flex h-9 items-center"
            style={{ border: "1px solid #DBEAFE", borderRadius: 4 }}
          >
            <SegmentedButton
              active={view === "list"}
              onClick={() => setView("list")}
            >
              <IconList className="h-3.5 w-3.5" />
              <span className="ml-1.5">List</span>
            </SegmentedButton>
            <span className="h-full w-px" style={{ background: "#DBEAFE" }} />
            <SegmentedButton
              active={view === "cards"}
              onClick={() => setView("cards")}
            >
              <IconGrid className="h-3.5 w-3.5" />
              <span className="ml-1.5">Cards</span>
            </SegmentedButton>
          </div>
        </section>

        {/* ---- Tag chips strip ---- */}
        <section className="mt-3 flex items-center gap-2">
          <div
            className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "thin" }}
          >
            {ALL_TAGS.map((t) => {
              const active = !!t.active;
              return (
                <button
                  key={t.id}
                  className="flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-[12px]"
                  style={{
                    border: active ? "1px solid #1E40AF" : "1px solid #DBEAFE",
                    background: active ? "#DBEAFE" : "#FFFFFF",
                    color: active ? "#1E40AF" : "#475569",
                    borderRadius: 2,
                    transition:
                      "border-color 150ms ease-out, background-color 150ms ease-out, color 150ms ease-out",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "#EFF6FF";
                      e.currentTarget.style.color = "#0A2540";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "#FFFFFF";
                      e.currentTarget.style.color = "#475569";
                    }
                  }}
                >
                  {active && (
                    <span
                      className="h-1.5 w-1.5"
                      style={{ background: "#1E40AF", borderRadius: 1 }}
                    />
                  )}
                  {t.name}
                </button>
              );
            })}
          </div>

          {/* AND / OR */}
          <div
            className="flex h-7 shrink-0 items-center text-[11px]"
            style={{ border: "1px solid #DBEAFE", borderRadius: 2 }}
          >
            {(["AND", "OR"] as const).map((m, i) => (
              <button
                key={m}
                onClick={() => setTagMode(m)}
                className="vd-mono flex h-full items-center gap-1.5 px-2"
                style={{
                  background: tagMode === m ? "#1E40AF" : "transparent",
                  color: tagMode === m ? "#FFFFFF" : "#475569",
                  borderLeft: i > 0 ? "1px solid #DBEAFE" : "none",
                  transition:
                    "background-color 150ms ease-out, color 150ms ease-out",
                }}
              >
                {tagMode === m && (
                  <span
                    className="inline-block h-1.5 w-1.5"
                    style={{ background: "#FFFFFF" }}
                  />
                )}
                {m}
              </button>
            ))}
          </div>
        </section>

        {/* ---- Bulk action ribbon ---- */}
        {selected.size >= 1 && (
          <section
            className="mt-3 flex h-10 items-center gap-2 px-3 text-[12px]"
            style={{
              background: "#EFF6FF",
              border: "1px solid #DBEAFE",
              borderRadius: 2,
            }}
          >
            <span className="vd-eyebrow text-[10.5px] font-medium text-[#1E40AF]">
              {String(selected.size).padStart(2, "0")} SELECTED
            </span>
            <button
              onClick={clearSelection}
              className="px-2 py-1 text-[#475569]"
              style={{
                borderRadius: 2,
                transition: "color 150ms ease-out, background-color 150ms ease-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#0A2540";
                e.currentTarget.style.background = "#FFFFFF";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#475569";
                e.currentTarget.style.background = "transparent";
              }}
            >
              Clear
            </button>
            <span className="mx-1 h-4 w-px" style={{ background: "#DBEAFE" }} />
            <BulkIconButton title="Bulk delete" hoverColor="#DC2626">
              <IconTrash />
            </BulkIconButton>
            <BulkIconButton title="Add tag">
              <IconTag />
            </BulkIconButton>
            <BulkIconButton title="Bundle as link">
              <IconLink />
            </BulkIconButton>

            <span className="vd-mono ml-auto text-[10.5px] text-[#94A3B8]">
              {selectedIdPreview}
            </span>
          </section>
        )}

        {/* ---- Data table panel ---- */}
        <section
          className="mt-3 bg-white"
          style={{ border: "1px solid #DBEAFE", borderRadius: 2 }}
        >
          {/* Sticky header */}
          <div
            className="flex h-9 items-center gap-3 px-3"
            style={{
              background: "#F8FAFC",
              borderBottom: "1px solid #DBEAFE",
            }}
          >
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={togglePage}
              className="h-4 w-4 cursor-pointer"
              style={{ accentColor: "#1E40AF" }}
              title="Select page"
            />
            <span className="vd-eyebrow w-[60px] text-[10px] text-[#475569]">
              ID
            </span>
            <span className="vd-eyebrow flex-1 text-[10px] text-[#475569]">
              Stem
            </span>
            <span className="vd-eyebrow w-[92px] text-[10px] text-[#475569]">
              Type
            </span>
            <span className="vd-eyebrow w-[210px] text-[10px] text-[#475569]">
              Tags
            </span>
            <span className="vd-eyebrow w-[110px] text-right text-[10px] text-[#475569]">
              Updated
            </span>
            <span className="vd-eyebrow w-[68px] text-right text-[10px] text-[#475569]">
              Actions
            </span>
          </div>

          {/* Rows */}
          <div>
            {QUESTIONS.map((qq, i) => {
              const isSel = selected.has(qq.id);
              return (
                <div
                  key={qq.id}
                  className="vd-row flex h-[52px] items-center gap-3 px-3"
                  style={{
                    borderBottom:
                      i === QUESTIONS.length - 1
                        ? "none"
                        : "1px solid #DBEAFE",
                    transition:
                      "background-color 150ms ease-out",
                  }}
                >
                  {/* Hover affordances */}
                  <span className="vd-row-bar" />
                  <span className="vd-bracket vd-b-tl" />
                  <span className="vd-bracket vd-b-tr" />
                  <span className="vd-bracket vd-b-bl" />
                  <span className="vd-bracket vd-b-br" />

                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleOne(qq.id)}
                    className="h-4 w-4 cursor-pointer"
                    style={{ accentColor: "#1E40AF" }}
                    title="Select this question"
                  />

                  <span className="vd-mono w-[60px] shrink-0 text-[12px] text-[#1E40AF]">
                    {qq.id}
                  </span>

                  <span className="block flex-1 truncate text-[13px] text-[#0F172A]">
                    {qq.stem}
                  </span>

                  {/* Type chip */}
                  <span className="w-[92px] shrink-0">
                    <span
                      className="vd-mono inline-flex h-[22px] items-center px-1.5 text-[10px] uppercase tracking-wider text-[#475569]"
                      style={{
                        border: "1px solid #DBEAFE",
                        borderRadius: 4,
                      }}
                    >
                      {qq.type}
                    </span>
                  </span>

                  {/* Tags */}
                  <span className="flex w-[210px] shrink-0 items-center gap-1 overflow-hidden">
                    {qq.tags.slice(0, 2).map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex h-[22px] max-w-[100px] shrink-0 items-center truncate px-1.5 text-[11px] text-[#475569]"
                        style={{
                          border: "1px solid #DBEAFE",
                          borderRadius: 2,
                        }}
                      >
                        {t.name}
                      </span>
                    ))}
                    {qq.tags.length > 2 && (
                      <span
                        className="vd-mono inline-flex h-[22px] shrink-0 items-center px-1.5 text-[10.5px] text-[#475569]"
                        style={{
                          border: "1px solid #DBEAFE",
                          borderRadius: 2,
                        }}
                      >
                        +{qq.tags.length - 2}
                      </span>
                    )}
                  </span>

                  <span className="vd-mono w-[110px] shrink-0 text-right text-[11.5px] text-[#475569]">
                    {qq.updatedAt}
                  </span>

                  <div className="vd-row-actions flex w-[68px] shrink-0 items-center justify-end gap-0.5">
                    <RowActionButton title="Edit">
                      <IconPencil />
                    </RowActionButton>
                    <RowActionButton title="Delete" hoverColor="#DC2626">
                      <IconTrash />
                    </RowActionButton>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- Pagination ---- */}
        <section className="mt-4 flex items-center justify-between">
          <span className="vd-mono text-[12px] text-[#475569]">
            {PAGE_FROM}–{PAGE_TO} of {TOTAL}
          </span>
          <div className="flex items-center gap-1">
            <PagerIconButton title="Previous">
              <IconChevronLeft />
            </PagerIconButton>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <PagerNumberButton key={n} active={n === PAGE_CURRENT}>
                {n}
              </PagerNumberButton>
            ))}
            <PagerIconButton title="Next">
              <IconChevronRight />
            </PagerIconButton>
          </div>
          <span className="vd-mono text-[10.5px] text-[#94A3B8]">
            PAGE {PAGE_CURRENT}/{PAGE_LAST}
          </span>
        </section>
      </main>

      {/* =========================== Footer =========================== */}
      <footer
        className="fixed bottom-0 left-0 right-0 z-20 h-7 bg-white"
        style={{ borderTop: "1px solid #DBEAFE" }}
      >
        <div className="vd-mono mx-auto flex h-full max-w-[1280px] items-center justify-between px-6 text-[11px] text-[#475569]">
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-1.5 w-1.5"
              style={{ background: "#1E40AF", borderRadius: 1 }}
            />
            <span className="text-[#1E40AF]">READY</span>
            <span className="text-[#94A3B8]">·</span>
            <span>87 records</span>
            <span className="text-[#94A3B8]">·</span>
            <span>last sync 12:04:55</span>
          </span>
          <span className="flex items-center gap-1.5 text-[#94A3B8]">
            <IconCommand className="h-2.5 w-2.5" /> K to search
          </span>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers (single-file)
// ---------------------------------------------------------------------------

function ToolIconButton({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      className="flex h-8 w-8 items-center justify-center text-[#475569]"
      style={{
        border: "1px solid #DBEAFE",
        borderRadius: 4,
        background: "#FFFFFF",
        transition:
          "border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#1E40AF";
        e.currentTarget.style.color = "#0A2540";
        e.currentTarget.style.background = "#EFF6FF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#DBEAFE";
        e.currentTarget.style.color = "#475569";
        e.currentTarget.style.background = "#FFFFFF";
      }}
    >
      {children}
    </button>
  );
}

function SegmentedButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-full items-center px-3 text-[12px]"
      style={{
        background: active ? "#1E40AF" : "transparent",
        color: active ? "#FFFFFF" : "#475569",
        transition:
          "background-color 150ms ease-out, color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = "#0A2540";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = "#475569";
      }}
    >
      {children}
    </button>
  );
}

function BulkIconButton({
  children,
  title,
  hoverColor,
}: {
  children: React.ReactNode;
  title: string;
  hoverColor?: string;
}) {
  const hc = hoverColor ?? "#0A2540";
  return (
    <button
      title={title}
      className="flex h-7 w-7 items-center justify-center text-[#475569]"
      style={{
        borderRadius: 2,
        transition:
          "color 150ms ease-out, background-color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hc;
        e.currentTarget.style.background = "#FFFFFF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "#475569";
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function RowActionButton({
  children,
  title,
  hoverColor,
}: {
  children: React.ReactNode;
  title: string;
  hoverColor?: string;
}) {
  const hc = hoverColor ?? "#0A2540";
  return (
    <button
      title={title}
      className="flex h-7 w-7 items-center justify-center text-[#475569]"
      style={{
        borderRadius: 2,
        transition: "color 150ms ease-out, background-color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hc;
        e.currentTarget.style.background = "#FFFFFF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "#475569";
        e.currentTarget.style.background = "transparent";
      }}
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
      className="flex h-7 w-7 items-center justify-center text-[#475569]"
      style={{
        border: "1px solid #DBEAFE",
        borderRadius: 4,
        background: "#FFFFFF",
        transition:
          "border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#1E40AF";
        e.currentTarget.style.color = "#0A2540";
        e.currentTarget.style.background = "#EFF6FF";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#DBEAFE";
        e.currentTarget.style.color = "#475569";
        e.currentTarget.style.background = "#FFFFFF";
      }}
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
      className="vd-mono flex h-7 w-7 items-center justify-center text-[12px]"
      style={{
        border: "1px solid #DBEAFE",
        borderRadius: 4,
        background: active ? "#1E40AF" : "#FFFFFF",
        color: active ? "#FFFFFF" : "#475569",
        transition:
          "border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "#1E40AF";
          e.currentTarget.style.color = "#0A2540";
          e.currentTarget.style.background = "#EFF6FF";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "#DBEAFE";
          e.currentTarget.style.color = "#475569";
          e.currentTarget.style.background = "#FFFFFF";
        }
      }}
    >
      {children}
    </button>
  );
}

// Background drifting geometric particle. 12×12 box; CAD-thin sapphire stroke.
function Particle({ kind }: { kind: "square" | "plus" | "circle" }) {
  const stroke = "#0B3B8C";
  const sw = 1.5;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="square"
      strokeLinejoin="miter"
      style={{ opacity: 0.1 }}
      aria-hidden
    >
      {kind === "square" && <rect x="3" y="3" width="6" height="6" />}
      {kind === "plus" && (
        <>
          <path d="M6 2v8" />
          <path d="M2 6h8" />
        </>
      )}
      {kind === "circle" && <circle cx="6" cy="6" r="3" />}
    </svg>
  );
}

// Helper that builds the absolute position style for a particle.
function particlePos(xPercent: number, yPercent: number): React.CSSProperties {
  return {
    position: "absolute",
    top: `${yPercent}%`,
    left: `${xPercent}%`,
    width: 12,
    height: 12,
    willChange: "transform",
  };
}
