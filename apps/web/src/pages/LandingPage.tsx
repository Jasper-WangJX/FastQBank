// FastQBank — public landing page (web only).
//
// "Blueprint × Spec": dark sapphire hero with the rotating wireframe
// hex sphere, a horizontal + a vertical sapphire sweep, and the mono
// FastQBank build telemetry. Below the dark/white split the white
// features section keeps D's calm spec-sheet vocabulary — slate text,
// mono `0X · FEATURE` eyebrows, sapphire-active hover borders, no
// motion. Decoration sits at z-0; content at z-10. All motion respects
// prefers-reduced-motion via the inline keyframes block.
//
// Wiring:
//   - `/` route renders this for ANY user (auth or not).
//   - "ENTER WEB →" navigates to /login for guests, /questions for
//     authenticated users (label flips to "OPEN APP →" in that case).
//   - The Windows installer is served as a static file at
//     /download/FastQBank-Setup-1.0.2.exe — see deploy/ for the
//     reverse-proxy alias that maps it to apps/desktop/release/.

import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const FEATURES = [
  {
    eyebrow: "// 01 · FEATURE",
    title: "AI tags & one-line summaries",
    body: "Every captured question gets suggested topic tags and a one-line summary. Accept, edit, or override — your taxonomy stays in your hands.",
  },
  {
    eyebrow: "// 02 · FEATURE",
    title: "OCR screenshot to import",
    body: "Press a global shortcut, crop a question on screen, and FastQBank parses stem, options, and math into a clean draft in under a second.",
  },
  {
    eyebrow: "// 03 · FEATURE",
    title: "Smart tag filters & bulk share",
    body: "Multi-axis tag filters, saved views, and one-click bulk share. Your taxonomy stays exactly where you put it — across web and desktop.",
  },
  {
    eyebrow: "// 04 · FEATURE",
    title: "Wrong-questions & flashcards",
    body: "Missed answers feed a spaced-repetition deck. Drill five on the bus or fifty before an exam — web and Windows, one synced library.",
  },
] as const;

// === Inline SVG icons — 16×16, sapphire-active stroke, 1.5px ===
type IconProps = { className?: string };

function IconSparkle({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M8 1.5v4" />
      <path d="M8 10.5v4" />
      <path d="M1.5 8h4" />
      <path d="M10.5 8h4" />
      <path d="M3.5 3.5l2.5 2.5" />
      <path d="M10 10l2.5 2.5" />
      <path d="M12.5 3.5L10 6" />
      <path d="M6 10l-2.5 2.5" />
    </svg>
  );
}

function IconScan({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M2 5V2.5h2.5" />
      <path d="M14 5V2.5h-2.5" />
      <path d="M2 11v2.5h2.5" />
      <path d="M14 11v2.5h-2.5" />
      <path d="M2 8h12" />
    </svg>
  );
}

function IconTag({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M2 2h6l6 6-6 6-6-6V2z" />
      <circle cx="5" cy="5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconRefresh({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M2 8a6 6 0 0 1 10.5-4" />
      <path d="M14 8a6 6 0 0 1-10.5 4" />
      <path d="M10.5 4H13V1.5" />
      <path d="M5.5 12H3v2.5" />
    </svg>
  );
}

const FEATURE_ICONS = [IconSparkle, IconScan, IconTag, IconRefresh] as const;

function IconDownload({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M8 2v8" />
      <path d="M4.5 7L8 10.5 11.5 7" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

function IconArrow({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
      aria-hidden
    >
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  );
}

// Wireframe hex sphere — concentric hexagons + radial spokes. Drawn as
// a single inline SVG, rotated by the `mesh-rotate` keyframe. Stroke is
// white at low opacity; the parent layer adds mix-blend-mode: screen.
function WireframeHexShape() {
  const center = 320;
  const rings = [60, 110, 160, 210, 260];
  const hexPoints = (cx: number, cy: number, r: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return pts.join(" ");
  };
  return (
    <svg
      viewBox="0 0 640 640"
      width="640"
      height="640"
      fill="none"
      stroke="white"
      strokeWidth="1"
      aria-hidden
    >
      {rings.map((r) => (
        <polygon
          key={`ring-${r}`}
          points={hexPoints(center, center, r)}
          stroke="white"
          strokeOpacity="0.55"
        />
      ))}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const r = 280;
        return (
          <line
            key={`spoke-${i}`}
            x1={center}
            y1={center}
            x2={center + r * Math.cos(a)}
            y2={center + r * Math.sin(a)}
            stroke="white"
            strokeOpacity="0.35"
          />
        );
      })}
      {Array.from({ length: 6 }).map((_, i) => {
        const a1 = (Math.PI / 3) * i - Math.PI / 2;
        const a2 = (Math.PI / 3) * ((i + 2) % 6) - Math.PI / 2;
        const r = 260;
        return (
          <line
            key={`web-${i}`}
            x1={center + r * Math.cos(a1)}
            y1={center + r * Math.sin(a1)}
            x2={center + r * Math.cos(a2)}
            y2={center + r * Math.sin(a2)}
            stroke="#60A5FA"
            strokeOpacity="0.6"
          />
        );
      })}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const r = 260;
        return (
          <circle
            key={`dot-${i}`}
            cx={center + r * Math.cos(a)}
            cy={center + r * Math.sin(a)}
            r="3"
            fill="#60A5FA"
            stroke="none"
          />
        );
      })}
      <circle cx={center} cy={center} r="4" fill="#60A5FA" stroke="none" />
    </svg>
  );
}

const TELEMETRY = ["OCR", "AI", "LATEX", "REVIEW"] as const;

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  // For signed-in users the "Enter Web →" CTA reads "Open App →" and
  // takes them straight into /questions. For guests it lands them on
  // /login (which after success re-routes back into /questions).
  const ctaTarget = isAuthenticated ? "/questions" : "/login";
  const ctaLabel = isAuthenticated ? "OPEN APP" : "ENTER WEB";

  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-white text-white">
      {/* Inline keyframes — scoped, no global stylesheet edits. */}
      <style>{`
        @keyframes mesh-rotate {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes sweep-h {
          /* The horizontal sweep is h-px (1px tall); translateY(%) is
             relative to the element's own height, so use absolute px so
             the line actually traverses the (min-h-[720px]) dark section. */
          0%   { transform: translateY(-40px); opacity: 0; }
          10%  { opacity: 0.85; }
          90%  { opacity: 0.85; }
          100% { transform: translateY(760px); opacity: 0; }
        }
        @keyframes sweep-v {
          0%   { transform: translateX(-4vw); opacity: 0; }
          10%  { opacity: 0.65; }
          90%  { opacity: 0.65; }
          100% { transform: translateX(104vw); opacity: 0; }
        }
        @keyframes dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.7); }
        }
        .fqb-mesh-rotate { animation: mesh-rotate 80s linear infinite; transform-origin: 50% 50%; }
        .fqb-sweep-h     { animation: sweep-h 22s linear infinite; }
        .fqb-sweep-v     { animation: sweep-v 26s linear infinite; animation-delay: -5s; }
        .fqb-dot-pulse   { animation: dot-pulse 1.6s ease-in-out infinite; }
        .fqb-cta:hover {
          background-color: rgba(96,165,250,0.08);
          box-shadow: 0 0 32px 0 rgba(96,165,250,0.30);
        }
        .fqb-card:hover {
          border-color: #1E3A8A;
        }
        @media (prefers-reduced-motion: reduce) {
          .fqb-mesh-rotate,
          .fqb-sweep-h,
          .fqb-sweep-v,
          .fqb-dot-pulse { animation: none !important; }
        }
      `}</style>

      {/* ============================================================
           TOP HALF — deep sapphire "blueprint" canvas.
           min-h ensures the 640px wireframe sphere always fits inside
           the dark section regardless of hero copy length.
           ============================================================ */}
      <div className="relative min-h-[720px] overflow-hidden bg-[#081A33]">
        {/* === Layer 1 — constant 48px fine grid === */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* === Layer 2 — rotating wireframe hex sphere === */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-10 z-0 -translate-x-1/2"
          style={{ mixBlendMode: "screen", opacity: 0.2 }}
        >
          <div className="fqb-mesh-rotate">
            <WireframeHexShape />
          </div>
        </div>

        {/* === Layer 3 — 1 horizontal sweep (top→bottom) + 1 vertical
              sweep (left→right) === */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <div
            className="fqb-sweep-h absolute left-0 right-0 h-px"
            style={{
              top: 0,
              background:
                "linear-gradient(to right, transparent, #60A5FA, transparent)",
            }}
          />
          <div
            className="fqb-sweep-v absolute bottom-0 top-0 w-px"
            style={{
              left: 0,
              background:
                "linear-gradient(to bottom, transparent, #60A5FA, transparent)",
            }}
          />
        </div>

        {/* === Sticky header (inherits the dark half) === */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#081A33]/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
            <img
              src="/fastqb-logo.png"
              alt=""
              className="h-7 w-7 select-none rounded-sm object-contain"
              draggable={false}
            />
            <span className="font-semibold tracking-tight text-white">
              FastQBank
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/35">
              v1.0.2
            </span>
            <Link
              to={ctaTarget}
              className="ml-auto inline-flex items-center gap-2 rounded-sm border border-white/25 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/85 transition-colors duration-150 hover:border-[#60A5FA] hover:text-[#60A5FA]"
            >
              {ctaLabel} <IconArrow />
            </Link>
          </div>
        </header>

        {/* === Hero === */}
        <section className="relative z-10 mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 pb-20 pt-16 md:pt-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
            // FASTQBANK · 1.0.2 · BLUEPRINT BUILD
          </p>

          <h1 className="text-[44px] font-semibold leading-[1.08] tracking-tight md:text-[52px] lg:text-[60px] lg:leading-[76px]">
            <span className="block text-white">Build your question bank.</span>
            <span className="block text-white/65">Pixel by pixel.</span>
          </h1>

          <p className="max-w-2xl text-base leading-relaxed text-white/65">
            OCR-driven capture, AI-suggested tags, drill-anywhere review — one
            library across web and Windows, with sharp pixels and zero
            ceremony.
          </p>

          <div className="mt-2 flex flex-col items-start gap-3">
            <a
              href="/download/FastQBank-Setup-1.0.2.exe"
              className="fqb-cta inline-flex items-center gap-3 rounded-sm bg-transparent px-6 py-3 font-mono text-[12px] uppercase tracking-[0.18em] text-white transition-all duration-200"
              style={{ border: "1.5px solid #60A5FA" }}
            >
              <IconDownload className="text-[#60A5FA]" />
              DOWNLOAD FOR WINDOWS · 1.0.2
            </a>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              ~ 300 MB · Win 10/11
            </p>
          </div>

          {/* Telemetry chips */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {TELEMETRY.map((label) => (
              <li
                key={label}
                className="rounded-sm border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/65"
              >
                {label}
              </li>
            ))}
          </ul>
        </section>

        {/* Bottom padding on the dark section so the hero doesn't butt
            up against the white half edge-to-edge. */}
        <div className="h-10" aria-hidden />
      </div>

      {/* ============================================================
           BOTTOM HALF — pure white "spec sheet" features (no motion)
           ============================================================ */}
      <div className="relative bg-white text-slate-900">
        <div className="mx-auto max-w-6xl px-6 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
            // FEATURES
          </p>
        </div>

        <section className="relative z-10 mx-auto max-w-6xl px-6 pb-8 pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {FEATURES.map((f, i) => {
              const Icon = FEATURE_ICONS[i];
              return (
                <article
                  key={f.eyebrow}
                  className="fqb-card rounded-sm border border-slate-200 bg-white p-5 transition-colors duration-150"
                >
                  <Icon className="text-[#1E3A8A]" />
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
                    {f.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[16px] font-semibold leading-snug tracking-tight text-slate-900">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {f.body}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {/* Spacer so the fixed status bar doesn't crop the last card row. */}
        <div className="h-7" aria-hidden />
      </div>

      {/* === Status footer — same sapphire-active strip as AppLayout === */}
      <footer
        className="fixed inset-x-0 bottom-0 z-20 flex h-7 items-center gap-4 border-t border-[#1E40AF] bg-[#1E3A8A] px-4 font-mono text-[11px] text-white/90"
        role="contentinfo"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="fqb-dot-pulse inline-block h-2 w-2 rounded-full bg-[#60A5FA]"
          />
          READY
        </span>
        <span className="ml-auto text-white/60">FastQBank · v1.0.2</span>
      </footer>
    </div>
  );
}
