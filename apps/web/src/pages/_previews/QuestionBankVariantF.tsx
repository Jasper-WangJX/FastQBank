/**
 * Variant F — "Sapphire Command"
 * Design intent: an aerospace cockpit-style data console — sharp clipped panels,
 * mono instrument readouts, hairline sapphire grid, dense yet quiet — every
 * flourish (sparkline, dial, axis-tick, row blip) serves the data, not decor.
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
 *  - X
 *  - Tag
 *  - Trash2
 *  - Pencil
 *  - ChevronLeft
 *  - ChevronRight
 *  - CornerDownLeft
 */

import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the real QuestionListOut shape, kept minimal for the preview
// ---------------------------------------------------------------------------

type QuestionType = "MCQ" | "FillBlank" | "TrueFalse";

interface TagLite {
  id: string;
  name: string;
}

interface Question {
  id: string;        // Display id, e.g. "Q-0042"
  stem: string;
  type: QuestionType;
  tags: TagLite[];
  deltaT: string;    // Mono "delta time since update" — cockpit feel
}

// ---------------------------------------------------------------------------
// Inline SVG icons — stroke 1.5, currentColor, viewBox 24, square caps
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
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </svg>
  );
}
function IconX({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
function IconTag({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M3 12V4h8l10 10-8 8L3 12z" />
      <circle cx="8" cy="8" r="1.5" />
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
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
function IconPencil({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M14 4l6 6-11 11H3v-6z" />
      <path d="M13 5l6 6" />
    </svg>
  );
}
function IconChevronLeft({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
function IconChevronRight({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function IconReturn({ className = baseSvg }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="square" strokeLinejoin="miter" className={className} aria-hidden>
      <path d="M9 10l-4 4 4 4" />
      <path d="M5 14h10a4 4 0 0 0 4-4V5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Clip-path constants — the signature "chopped corner" cockpit panel
// ---------------------------------------------------------------------------

// Both diagonally-opposite corners chopped 8px.
const CLIP_8 =
  "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))";
// Smaller 4px chop for buttons / mini-panels.
const CLIP_4 =
  "polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))";
// HUD strip — both ends chopped on the short edges (top-left + bottom-right).
const CLIP_HUD =
  "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const ALL_TAGS: TagLite[] = [
  { id: "t-algebra", name: "Algebra" },
  { id: "t-calc", name: "Calculus" },
  { id: "t-prob", name: "Probability" },
  { id: "t-linalg", name: "Linear algebra" },
  { id: "t-stats", name: "Statistics" },
  { id: "t-geom", name: "Geometry" },
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
    deltaT: "00d 02h",
  },
  {
    id: "Q-0041",
    stem: "The derivative of sin(x) with respect to x equals ____ — fill in the blank.",
    type: "FillBlank",
    tags: [{ id: "t-calc", name: "Calculus" }],
    deltaT: "00d 05h",
  },
  {
    id: "Q-0040",
    stem: "TCP guarantees in-order delivery of bytes between two endpoints. True or false?",
    type: "TrueFalse",
    tags: [{ id: "t-net", name: "Networking" }, { id: "t-os", name: "OS" }, { id: "t-2024", name: "2024 set" }],
    deltaT: "00d 14h",
  },
  {
    id: "Q-0039",
    stem: "Let A be an n×n matrix. Which of these statements is equivalent to A being invertible?",
    type: "MCQ",
    tags: [{ id: "t-linalg", name: "Linear algebra" }],
    deltaT: "00d 19h",
  },
  {
    id: "Q-0038",
    stem: "A fair six-sided die is rolled twice. The probability that the sum is exactly 7 is ____.",
    type: "FillBlank",
    tags: [{ id: "t-prob", name: "Probability" }, { id: "t-stats", name: "Statistics" }],
    deltaT: "01d 04h",
  },
  {
    id: "Q-0037",
    stem: "In a binary heap, the parent of the node at index i is at index floor((i-1)/2). True or false?",
    type: "TrueFalse",
    tags: [{ id: "t-ds", name: "Data structures" }],
    deltaT: "01d 17h",
  },
  {
    id: "Q-0036",
    stem: "Which integration technique is most appropriate for evaluating the integral of x·e^x dx?",
    type: "MCQ",
    tags: [{ id: "t-calc", name: "Calculus" }, { id: "t-mock", name: "Mock exam" }],
    deltaT: "02d 03h",
  },
  {
    id: "Q-0035",
    stem: "The sum of the interior angles of a convex polygon with n sides equals ____ degrees.",
    type: "FillBlank",
    tags: [{ id: "t-geom", name: "Geometry" }],
    deltaT: "02d 14h",
  },
];

const TOTAL = 87;
const TAGGED = 12;
const PAGE_FROM = 1;
const PAGE_TO = 10;
const PAGE_INDEX = 1;
const PAGE_COUNT = 9;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuestionBankVariantF() {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["Q-0041", "Q-0040", "Q-0038"]),
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "cards">("list");
  const [tagMode, setTagMode] = useState<"AND" | "OR">("AND");
  const [activeTags, setActiveTags] = useState<Set<string>>(
    () => new Set(["t-ds", "t-calc"]),
  );
  const [keyword, setKeyword] = useState("");
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  const selectedIds = useMemo(
    () => [...selected].sort().slice(0, 3),
    [selected],
  );

  function toggleOne(id: string) {
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
  function clearSelection() {
    setSelected(new Set());
  }
  function clearFilters() {
    setKeyword("");
    setActiveTags(new Set());
  }

  // Engineering paper grid: 8px minor + 40px major, sapphire-100 tint.
  const pageBg: React.CSSProperties = {
    backgroundImage: [
      // Major lines (40px) — slightly stronger
      "linear-gradient(to right,  rgba(219, 234, 254, 0.55) 1px, transparent 1px)",
      "linear-gradient(to bottom, rgba(219, 234, 254, 0.55) 1px, transparent 1px)",
      // Minor lines (8px) — very faint
      "linear-gradient(to right,  rgba(219, 234, 254, 0.25) 1px, transparent 1px)",
      "linear-gradient(to bottom, rgba(219, 234, 254, 0.25) 1px, transparent 1px)",
    ].join(", "),
    backgroundSize: "40px 40px, 40px 40px, 8px 8px, 8px 8px",
    backgroundPosition: "0 0, 0 0, 0 0, 0 0",
  };

  return (
    <div
      className="relative min-h-dvh w-full bg-white text-slate-900 antialiased"
      style={{
        fontFamily:
          'ui-sans-serif, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        letterSpacing: "-0.005em",
      }}
    >
      {/* Inline keyframes + helper classes */}
      <style>{`
        @keyframes vfSweep {
          0%   { transform: translateY(-4vh); opacity: 0; }
          10%  { opacity: 0.06; }
          90%  { opacity: 0.06; }
          100% { transform: translateY(104vh); opacity: 0; }
        }
        @keyframes vfPulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes vfPulseGlow {
          0%, 100% { opacity: 0.10; transform: scale(1); }
          50%      { opacity: 0.18; transform: scale(1.04); }
        }
        @keyframes vfBlip {
          from { stroke-dashoffset: 16; }
          to   { stroke-dashoffset: 0; }
        }
        .vf-mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-feature-settings: "tnum" 1, "cv01" 1; }
        .vf-sweep { position: fixed; left: 0; right: 0; height: 1px; background: #60A5FA; opacity: 0; pointer-events: none; }
        .vf-sweep-1 { animation: vfSweep 17s linear infinite;            animation-delay: 0s; }
        .vf-sweep-2 { animation: vfSweep 23s linear infinite;            animation-delay: 4s; }
        .vf-sweep-3 { animation: vfSweep 19s linear infinite;            animation-delay: 9s; }
        .vf-sweep-4 { animation: vfSweep 25s linear infinite;            animation-delay: 13s; }
        .vf-pulse-dot  { animation: vfPulseDot 1.4s ease-in-out infinite; }
        .vf-pulse-glow { animation: vfPulseGlow 8s ease-in-out infinite; }
        .vf-row-blip   { stroke-dasharray: 16; stroke-dashoffset: 16; }
        .vf-row:hover .vf-row-blip { animation: vfBlip 180ms ease-out forwards; }
        .vf-row:hover .vf-row-bar  { transform: scaleY(1); }
        .vf-row:hover .vf-row-act  { opacity: 1; }
        .vf-row-bar { transform: scaleY(0); transform-origin: center; transition: transform 140ms ease-out; }
        .vf-row-act { opacity: 0.3; transition: opacity 140ms ease-out; }
        .vf-cell-hover:hover { background: #EFF6FF; }
        @media (prefers-reduced-motion: reduce) {
          .vf-sweep-1, .vf-sweep-2, .vf-sweep-3, .vf-sweep-4,
          .vf-pulse-dot, .vf-pulse-glow { animation: none !important; }
          .vf-row:hover .vf-row-blip { animation: none !important; stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Background: engineering paper grid */}
      <div className="pointer-events-none fixed inset-0 -z-10" style={pageBg} aria-hidden />

      {/* Radar sweep pulses — four staggered horizontal lines */}
      {!reducedMotion && (
        <>
          <div className="vf-sweep vf-sweep-1" aria-hidden />
          <div className="vf-sweep vf-sweep-2" aria-hidden />
          <div className="vf-sweep vf-sweep-3" aria-hidden />
          <div className="vf-sweep vf-sweep-4" aria-hidden />
        </>
      )}

      {/* Bottom-right radial sapphire glow */}
      <div
        aria-hidden
        className={`pointer-events-none fixed bottom-10 right-10 -z-10 ${reducedMotion ? "" : "vf-pulse-glow"}`}
        style={{
          width: 80,
          height: 80,
          background:
            "radial-gradient(closest-side, rgba(11,59,140,0.35), rgba(11,59,140,0) 70%)",
          opacity: 0.1,
        }}
      />

      {/* ============================ Header ============================ */}
      <header
        className="sticky top-0 z-30 h-[60px] w-full border-b border-[#DBEAFE] bg-white"
      >
        <div className="mx-auto flex h-full max-w-[1280px] items-center gap-4 px-6">
          {/* Logo + wordmark + version chip */}
          <a href="#" className="flex items-center gap-2">
            <img
              src="/fastqb-logo.png"
              alt="FastQBank"
              width={24}
              height={24}
              style={{ borderRadius: 2 }}
            />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">
              FastQBank
            </span>
          </a>
          <span className="vf-mono inline-flex h-5 items-center rounded-[2px] border border-[#DBEAFE] bg-[#F8FAFC] px-1.5 text-[10px] text-slate-600">
            v0.9.0
          </span>

          {/* Mission cluster */}
          <div className="ml-2 flex items-center gap-2">
            <span className="vf-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              MISSION
            </span>
            <span
              className="vf-mono inline-flex h-6 items-center gap-1.5 border border-[#DBEAFE] bg-white px-2 text-[10px] uppercase tracking-[0.18em] text-[#0B3B8C]"
              style={{ clipPath: CLIP_4 }}
            >
              <span className="vf-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[#1E40AF]" />
              QUESTION BANK · ACTIVE
            </span>
          </div>

          {/* Nav chips */}
          <nav className="ml-3 hidden items-center gap-1 md:flex">
            <button className="vf-mono inline-flex h-6 items-center rounded-[2px] border border-transparent px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500 hover:border-[#DBEAFE] hover:text-[#1E40AF]">
              [ NEW ]
            </button>
            <button className="vf-mono inline-flex h-6 items-center rounded-[2px] border border-transparent px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500 hover:border-[#DBEAFE] hover:text-[#1E40AF]">
              [ REVIEW ]
            </button>
          </nav>

          {/* Right side: status cluster + ⌘K + avatar + log out */}
          <div className="ml-auto flex items-center gap-3">
            <div className="vf-mono hidden items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-slate-500 md:flex">
              <span className="inline-flex items-center gap-1.5">
                <span className="vf-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[#1E40AF]" />
                SYNC
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#60A5FA]" />
                OCR · STANDBY
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full border border-slate-300 bg-white" />
                ALERTS
              </span>
            </div>
            <div className="h-5 w-px bg-[#DBEAFE]" />
            <span
              className="vf-mono inline-flex h-6 items-center gap-1 rounded-[2px] border border-[#DBEAFE] bg-[#F8FAFC] px-2 text-[10px] text-slate-600"
              title="Keyboard palette"
            >
              <IconCommand className="h-3 w-3" />
              K
            </span>
            <div
              className="flex h-7 w-7 items-center justify-center bg-[#0B3B8C] text-[11px] font-semibold text-white"
              style={{ borderRadius: 2 }}
              title="JW"
            >
              JW
            </div>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-[2px] text-slate-500 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]"
              title="Log out"
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ============================ HUD strip ============================ */}
      <div className="mx-auto max-w-[1280px] px-6 pt-4">
        <div
          className="flex h-10 items-center justify-between border border-[#DBEAFE] bg-[#F8FAFC] px-5"
          style={{ clipPath: CLIP_HUD }}
        >
          <HudReadout
            label="TOTAL"
            value="0087"
            accessory={
              <svg width="32" height="20" viewBox="0 0 32 20" aria-hidden>
                <polyline
                  points="0,14 4,12 8,15 12,9 16,11 20,5 24,7 28,3 32,8"
                  fill="none"
                  stroke="#60A5FA"
                  strokeWidth="1.25"
                  strokeLinecap="square"
                />
              </svg>
            }
          />
          <HudDivider />
          <HudReadout
            label="TAGGED"
            value={`${String(TAGGED).padStart(4, "0")} / ${String(TOTAL).padStart(4, "0")}`}
            accessory={
              // Radial dial — ~14% coverage
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="9" fill="none" stroke="#DBEAFE" strokeWidth="1.5" />
                {/* Arc: 14% of full circle = 50.4deg. Use stroke-dasharray on circle */}
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="#1E40AF"
                  strokeWidth="1.5"
                  strokeDasharray={`${(14 / 100) * 2 * Math.PI * 9} ${2 * Math.PI * 9}`}
                  transform="rotate(-90 12 12)"
                  strokeLinecap="square"
                />
                <circle cx="12" cy="12" r="1.25" fill="#0B3B8C" />
              </svg>
            }
          />
          <HudDivider />
          <HudReadout
            label="LAST SYNC"
            value="12:04:55Z"
            accessory={
              <span
                className={reducedMotion ? "" : "vf-pulse-dot"}
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  background: "#1E40AF",
                }}
              />
            }
          />
        </div>
      </div>

      {/* ============================ Main layout ============================ */}
      <main className="mx-auto max-w-[1280px] px-6 pb-12 pt-5">
        {/* Page header row */}
        <div className="flex items-end justify-between">
          <div>
            <div className="vf-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              MODULE
            </div>
            <h1 className="mt-0.5 text-[24px] font-semibold leading-tight tracking-tight text-slate-900">
              Question bank
            </h1>
            <div className="vf-mono mt-1 text-[11px] text-slate-500">
              87 records indexed
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <IconBtn label="OCR capture"><IconCamera /></IconBtn>
            <IconBtn label="Import"><IconUpload /></IconBtn>
            <IconBtn label="My shares"><IconLink /></IconBtn>
            <button
              className="vf-mono ml-1.5 inline-flex h-9 items-center gap-2 bg-[#1E40AF] px-3.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors duration-150 hover:bg-[#2563EB]"
              style={{ clipPath: CLIP_4 }}
            >
              <IconPlus className="h-4 w-4" />
              NEW QUESTION
              <span
                className="ml-1 inline-flex h-4 items-center rounded-[2px] border border-white/30 bg-white/10 px-1 text-[10px]"
                aria-hidden
              >
                N
              </span>
            </button>
          </div>
        </div>

        {/* Two-column body: content + right sidebar */}
        <div className="mt-5 grid grid-cols-[1fr_220px] gap-5">
          {/* ============================ Left column ============================ */}
          <div className="min-w-0 space-y-3">
            {/* Filter bar */}
            <div
              className="border border-[#DBEAFE] bg-white p-3"
              style={{ clipPath: CLIP_8 }}
            >
              <div className="flex items-center gap-2">
                {/* Search + axis-tick scale above */}
                <div className="flex-1">
                  {/* Axis-tick scale — 5 ticks A E I O Z */}
                  <div className="mb-1 ml-7 flex h-3 items-end justify-between pr-7">
                    {["A", "E", "I", "O", "Z"].map((c, i) => (
                      <div
                        key={c}
                        className="flex flex-col items-center"
                        style={{ width: 8 }}
                      >
                        <div
                          className="bg-[#94A3B8]"
                          style={{ width: 1, height: i === 0 || i === 4 ? 6 : 4 }}
                        />
                        <span className="vf-mono mt-0.5 text-[8px] tracking-[0.18em] text-slate-400">
                          {c}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Search stem…"
                      className="vf-mono w-full rounded-[3px] border border-[#DBEAFE] bg-white py-1.5 pl-8 pr-16 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1E40AF]"
                    />
                    <span className="vf-mono pointer-events-none absolute right-2 top-1/2 inline-flex h-5 -translate-y-1/2 items-center gap-1 rounded-[2px] border border-[#DBEAFE] bg-[#F8FAFC] px-1.5 text-[10px] text-slate-500">
                      <IconCommand className="h-3 w-3" />
                      K
                    </span>
                  </div>
                </div>
                {/* Clear ghost */}
                <button
                  onClick={clearFilters}
                  className="vf-mono h-9 self-end rounded-[3px] border border-[#DBEAFE] bg-white px-3 text-[11px] uppercase tracking-[0.14em] text-slate-600 transition-colors duration-150 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]"
                >
                  CLEAR
                </button>
                {/* List/Cards segmented toggle */}
                <div
                  className="flex h-9 self-end overflow-hidden rounded-[3px] border border-[#DBEAFE] bg-white"
                  role="tablist"
                >
                  <SegBtn active={view === "list"} onClick={() => setView("list")}>
                    <IconList className="h-3.5 w-3.5" />
                    LIST
                  </SegBtn>
                  <span className="w-px self-stretch bg-[#DBEAFE]" />
                  <SegBtn active={view === "cards"} onClick={() => setView("cards")}>
                    <IconGrid className="h-3.5 w-3.5" />
                    CARDS
                  </SegBtn>
                </div>
              </div>
            </div>

            {/* Tag filter strip */}
            <div className="flex flex-wrap items-center gap-2">
              {ALL_TAGS.map((t) => {
                const active = activeTags.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTag(t.id)}
                    className={
                      "inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2 text-[11px] transition-colors duration-150 " +
                      (active
                        ? "border-[#1E40AF] bg-[#DBEAFE] text-[#0B3B8C]"
                        : "border-[#DBEAFE] bg-white text-slate-600 hover:bg-[#EFF6FF]")
                    }
                  >
                    <span
                      className={
                        "inline-block h-1.5 w-1.5 " +
                        (active ? "bg-[#1E40AF]" : "bg-[#94A3B8]")
                      }
                    />
                    <span className="vf-mono uppercase tracking-[0.12em]">{t.name}</span>
                  </button>
                );
              })}

              {/* AND / OR mini-panel */}
              <div
                className="ml-auto flex h-7 items-center overflow-hidden border border-[#DBEAFE] bg-white"
                style={{ clipPath: CLIP_4 }}
              >
                <button
                  onClick={() => setTagMode("AND")}
                  className={
                    "vf-mono h-full px-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 " +
                    (tagMode === "AND"
                      ? "bg-[#1E40AF] text-white"
                      : "text-slate-500 hover:bg-[#EFF6FF]")
                  }
                >
                  AND
                </button>
                <span className="h-full w-px bg-[#DBEAFE]" />
                <button
                  onClick={() => setTagMode("OR")}
                  className={
                    "vf-mono h-full px-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 " +
                    (tagMode === "OR"
                      ? "bg-[#1E40AF] text-white"
                      : "text-slate-500 hover:bg-[#EFF6FF]")
                  }
                >
                  OR
                </button>
              </div>
            </div>

            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div
                className="flex items-center gap-3 border border-[#DBEAFE] bg-[#F8FAFC] px-3 py-2"
                style={{ clipPath: CLIP_8 }}
              >
                <span className="vf-mono text-[11px] uppercase tracking-[0.18em] text-[#0B3B8C]">
                  [ {String(selected.size).padStart(2, "0")} SELECTED · UNITS ]
                </span>
                <button
                  onClick={clearSelection}
                  className="vf-mono inline-flex items-center gap-1 rounded-[2px] border border-[#DBEAFE] bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-600 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]"
                >
                  <IconX className="h-3 w-3" />
                  CLEAR
                </button>
                <span className="h-5 w-px bg-[#DBEAFE]" />
                <BulkIconBtn label="Bulk delete" danger>
                  <IconTrash />
                </BulkIconBtn>
                <BulkIconBtn label="Add tag">
                  <IconTag />
                </BulkIconBtn>
                <BulkIconBtn label="Bundle as link">
                  <IconLink />
                </BulkIconBtn>
                <span className="vf-mono ml-auto truncate text-[10px] tracking-[0.10em] text-slate-500">
                  {selectedIds.join("  ")}
                </span>
              </div>
            )}

            {/* Table */}
            <div
              className="border border-[#DBEAFE] bg-white"
              style={{ clipPath: CLIP_8 }}
            >
              {/* Sticky header */}
              <div
                className="vf-mono grid items-center gap-3 border-b border-[#DBEAFE] bg-[#F8FAFC] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-slate-500"
                style={{
                  gridTemplateColumns:
                    "20px 40px 76px 1fr 90px 180px 80px 64px",
                }}
              >
                <span aria-hidden>
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[#1E40AF]"
                    aria-label="Select all"
                  />
                </span>
                <span>IDX</span>
                <span>ID</span>
                <span>STEM</span>
                <span>TYPE</span>
                <span>TAGS</span>
                <span>Δt</span>
                <span className="text-right">ACT</span>
              </div>

              {/* Rows */}
              <div>
                {QUESTIONS.map((q, idx) => {
                  const sel = selected.has(q.id);
                  return (
                    <div
                      key={q.id}
                      onMouseEnter={() => setHoveredId(q.id)}
                      onMouseLeave={() => setHoveredId((h) => (h === q.id ? null : h))}
                      onClick={() => toggleOne(q.id)}
                      className={
                        "vf-row relative grid cursor-pointer items-center gap-3 border-b border-[#DBEAFE] px-3 py-2.5 text-[12.5px] transition-colors duration-150 " +
                        (sel
                          ? "bg-[#EFF6FF]"
                          : "bg-white hover:bg-[#EFF6FF]")
                      }
                      style={{
                        gridTemplateColumns:
                          "20px 40px 76px 1fr 90px 180px 80px 64px",
                      }}
                    >
                      {/* Hover left bar */}
                      <span
                        className="vf-row-bar absolute left-0 top-0 h-full w-[2px] bg-[#1E40AF]"
                        aria-hidden
                      />
                      {/* Right-edge "blip" — a tiny 16px horizontal sapphire-400 stroke */}
                      <svg
                        className="pointer-events-none absolute right-[-16px] top-1/2 -translate-y-1/2"
                        width="16"
                        height="2"
                        viewBox="0 0 16 2"
                        aria-hidden
                      >
                        <line
                          className="vf-row-blip"
                          x1="0"
                          y1="1"
                          x2="16"
                          y2="1"
                          stroke="#60A5FA"
                          strokeWidth="1.5"
                          strokeLinecap="square"
                        />
                      </svg>

                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleOne(q.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 accent-[#1E40AF]"
                        aria-label={`Select ${q.id}`}
                      />
                      <span className="vf-mono text-[11px] text-slate-400">
                        {String(idx + 1).padStart(4, "0")}
                      </span>
                      <span className="vf-mono text-[12px] font-medium text-[#1E40AF]">
                        {q.id}
                      </span>
                      <span className="min-w-0 truncate text-slate-900">
                        {q.stem}
                      </span>
                      <span>
                        <span className="vf-mono inline-flex h-5 items-center rounded-[2px] border border-[#DBEAFE] bg-[#F8FAFC] px-1.5 text-[10px] uppercase tracking-[0.14em] text-[#0B3B8C]">
                          {q.type === "MCQ"
                            ? "MCQ"
                            : q.type === "FillBlank"
                              ? "FILLBLANK"
                              : "TRUEFALSE"}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1">
                        {q.tags.slice(0, 2).map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex h-5 max-w-[88px] items-center rounded-[2px] border border-[#DBEAFE] bg-white px-1.5 text-[10.5px] text-slate-600"
                          >
                            <span className="truncate">{t.name}</span>
                          </span>
                        ))}
                        {q.tags.length > 2 && (
                          <span className="vf-mono inline-flex h-5 items-center rounded-[2px] border border-dashed border-[#DBEAFE] bg-white px-1 text-[10px] text-slate-500">
                            +{q.tags.length - 2}
                          </span>
                        )}
                      </span>
                      <span className="vf-mono text-[11px] text-slate-500">
                        Δt {q.deltaT}
                      </span>
                      <span className="vf-row-act flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] text-slate-500 transition-colors duration-150 hover:bg-white hover:text-[#0B3B8C]"
                          title="Edit"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] text-slate-500 transition-colors duration-150 hover:bg-white hover:text-[#DC2626]"
                          title="Delete"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </span>

                      {/* The hovered row id is read once to silence ts-unused */}
                      {hoveredId === q.id ? <span className="hidden" aria-hidden /> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between pt-1">
              <div className="vf-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
                PG {PAGE_INDEX}/{PAGE_COUNT} · DISPLAY{" "}
                {String(PAGE_FROM).padStart(4, "0")}..
                {String(PAGE_TO).padStart(4, "0")} OF{" "}
                {String(TOTAL).padStart(4, "0")}
              </div>
              <div className="flex items-center gap-1.5">
                <PageBtn aria="Previous page">
                  <IconChevronLeft className="h-3.5 w-3.5" />
                </PageBtn>
                {[1, 2, 3, 4, 5].map((p) => (
                  <PageBtn key={p} active={p === PAGE_INDEX}>
                    {p}
                  </PageBtn>
                ))}
                <span className="vf-mono px-1 text-[11px] text-slate-400">…</span>
                <PageBtn>{PAGE_COUNT}</PageBtn>
                <PageBtn aria="Next page">
                  <IconChevronRight className="h-3.5 w-3.5" />
                </PageBtn>
                <span className="ml-3 inline-flex items-center gap-2">
                  <span className="vf-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    JUMP
                  </span>
                  <IconReturn className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    aria-label="Jump to page"
                    placeholder="__"
                    className="vf-mono h-7 w-12 rounded-[2px] border border-[#DBEAFE] bg-white px-2 text-center text-[11px] outline-none placeholder:text-slate-400 focus:border-[#1E40AF]"
                  />
                </span>
              </div>
            </div>
          </div>

          {/* ============================ Right sidebar ============================ */}
          <aside
            className="space-y-4 border border-[#DBEAFE] bg-white p-4"
            style={{ clipPath: CLIP_8 }}
          >
            <div className="vf-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
              INSTRUMENT READOUTS
            </div>

            {/* TYPE DISTRIBUTION */}
            <div>
              <div className="vf-mono mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                TYPE DISTRIBUTION
              </div>
              <div className="space-y-2">
                <DistBar label="MCQ" pct={60} shade="#1E40AF" />
                <DistBar label="FILLBLANK" pct={25} shade="#2563EB" />
                <DistBar label="TRUEFALSE" pct={15} shade="#60A5FA" />
              </div>
            </div>

            <div className="h-px w-full bg-[#DBEAFE]" />

            {/* TAG VELOCITY */}
            <div>
              <div className="vf-mono mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <span>TAG VELOCITY · 24H</span>
                <span className="text-[#1E40AF]">+09</span>
              </div>
              <svg width="180" height="40" viewBox="0 0 180 40" aria-hidden className="block">
                {/* Faint baseline */}
                <line x1="0" y1="36" x2="180" y2="36" stroke="#DBEAFE" strokeWidth="1" />
                <polyline
                  points="0,30 15,28 30,32 45,22 60,26 75,18 90,24 105,12 120,16 135,10 150,14 165,8 180,12"
                  fill="none"
                  stroke="#60A5FA"
                  strokeWidth="1.25"
                  strokeLinecap="square"
                />
              </svg>
            </div>

            <div className="h-px w-full bg-[#DBEAFE]" />

            {/* RECENT ACTIONS */}
            <div>
              <div className="vf-mono mb-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                RECENT ACTIONS
              </div>
              <ul className="space-y-1.5">
                {[
                  { sym: "+", id: "Q-0041", t: "12:04Z" },
                  { sym: "~", id: "Q-0033", t: "11:58Z" },
                  { sym: "−", id: "Q-0019", t: "11:51Z" },
                ].map((r) => (
                  <li
                    key={r.id}
                    className="vf-mono flex items-center justify-between text-[11px] text-slate-600"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-center text-[#0B3B8C]">{r.sym}</span>
                      <span>{r.id}</span>
                    </span>
                    <span className="text-slate-400">{r.t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>

      {/* ============================ Status footer ============================ */}
      <footer className="sticky bottom-0 left-0 right-0 z-30 flex h-7 items-center bg-[#0A2540] px-6">
        <div className="vf-mono mx-auto flex w-full max-w-[1280px] items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-white/85">
          <span className="flex items-center gap-2">
            <span className="vf-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[#60A5FA]" />
            ALL SYSTEMS NOMINAL · 87 RECORDS · SELECTION {selected.size} · SYNC 12:04:55Z
          </span>
          <span className="flex items-center gap-3 text-white/65">
            <span className="inline-flex items-center gap-1">
              <IconCommand className="h-3 w-3" />K PALETTE
            </span>
            <span>↵ OPEN</span>
            <span>⌫ DELETE</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HudReadout({
  label,
  value,
  accessory,
}: {
  label: string;
  value: string;
  accessory?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="vf-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
        {label}
      </span>
      <span className="vf-mono text-[13px] font-medium tracking-[0.04em] text-[#0A2540]">
        {value}
      </span>
      {accessory ? <span className="flex items-center">{accessory}</span> : null}
    </div>
  );
}

function HudDivider() {
  return <span className="h-5 w-px bg-[#DBEAFE]" aria-hidden />;
}

function IconBtn({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-[3px] border border-[#DBEAFE] bg-white text-slate-600 transition-colors duration-150 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]"
    >
      {children}
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "vf-mono inline-flex h-full items-center gap-1.5 px-3 text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 " +
        (active
          ? "bg-[#1E40AF] text-white"
          : "text-slate-600 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]")
      }
    >
      {children}
    </button>
  );
}

function BulkIconBtn({
  children,
  label,
  danger = false,
}: {
  children: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      className={
        "flex h-7 w-7 items-center justify-center rounded-[2px] border border-[#DBEAFE] bg-white transition-colors duration-150 " +
        (danger
          ? "text-slate-600 hover:border-[#DC2626] hover:text-[#DC2626]"
          : "text-slate-600 hover:text-[#0B3B8C] hover:bg-[#EFF6FF]")
      }
    >
      {children}
    </button>
  );
}

function PageBtn({
  children,
  active = false,
  aria,
}: {
  children: React.ReactNode;
  active?: boolean;
  aria?: string;
}) {
  return (
    <button
      aria-label={aria}
      className={
        "vf-mono inline-flex h-7 min-w-[28px] items-center justify-center rounded-[2px] border px-1.5 text-[11px] transition-colors duration-150 " +
        (active
          ? "border-[#1E40AF] bg-[#1E40AF] text-white"
          : "border-[#DBEAFE] bg-white text-slate-600 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]")
      }
    >
      {children}
    </button>
  );
}

function DistBar({
  label,
  pct,
  shade,
}: {
  label: string;
  pct: number;
  shade: string;
}) {
  return (
    <div>
      <div className="vf-mono mb-0.5 flex items-baseline justify-between text-[10px] tracking-[0.10em] text-slate-500">
        <span>{label}</span>
        <span className="text-slate-600">{pct}%</span>
      </div>
      <div
        className="relative h-2 w-full border border-[#DBEAFE] bg-[#F8FAFC]"
        aria-hidden
      >
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: shade }}
        />
      </div>
    </div>
  );
}
