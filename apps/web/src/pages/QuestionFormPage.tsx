// Create / edit a question. One component, two modes (presence of :id).
// Client-side rules mirror the backend QuestionIn validator, but the
// server's 422 is the source of truth and is surfaced in the error box.
//
// Visual layer: "Sapphire Console" (Variant E). Sharp 2px corners, mono
// metadata, sapphire palette. Behavior is unchanged from the previous
// implementation — only Tailwind classes and decorative markup move.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ChevronDown,
  CornerDownLeft,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ApiError } from "../lib/api";
import {
  createQuestion,
  getQuestion,
  listTags,
  updateQuestion,
  type Option,
  type QuestionType,
  type Tag,
} from "../lib/qbank";
import type { OcrPrefill } from "../lib/desktop";
import {
  knowledgeSummary as aiKnowledgeSummary,
  parseQuestion,
  suggestTags,
} from "../lib/ai";
import { looksLikeFormula } from "../lib/ocr/splitter";
import TagPicker from "../components/tags/TagPicker";
import Latex from "../components/Latex";

const JUDGE_OPTIONS: Option[] = [
  { label: "T", content: "True" },
  { label: "F", content: "False" },
];

// Shared style fragments — keeps the class soup deduplicated.
const MONO_FONT =
  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace";
const SANS_FONT = "ui-sans-serif, Inter, system-ui, sans-serif";
const EYEBROW_CLS =
  "font-mono uppercase tracking-[0.18em] text-[10px] text-slate-500";
const LABEL_CLS =
  "block font-mono uppercase tracking-[0.1em] text-[11px] text-slate-500";
const INPUT_CLS =
  "w-full rounded-sm border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-colors duration-120 focus:border-[#1E3A8A]";

// Smallest unused A.. letter, so deletes leave gaps but labels stay stable.
function nextLabel(opts: Option[]): string {
  const used = new Set(opts.map((o) => o.label));
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i);
    if (!used.has(L)) return L;
  }
  return `X${opts.length + 1}`;
}

export default function QuestionFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  // Draft handed over by AppLayout after an OCR capture (router state,
  // so it never hits the URL and the manual/edit paths are untouched).
  const ocrPrefill =
    (location.state as { ocrPrefill?: OcrPrefill } | null)?.ocrPrefill ??
    null;

  const [stem, setStem] = useState("");
  const [type, setType] = useState<QuestionType>("single");
  const [options, setOptions] = useState<Option[]>([
    { label: "A", content: "" },
    { label: "B", content: "" },
  ]);
  const [correct, setCorrect] = useState<string[]>([]);
  const [knowledgeSummary, setKnowledgeSummary] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [source, setSource] = useState<"manual" | "ocr">("manual");

  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stage-6 AI: all on-demand (button-triggered), never automatic.
  const [aiBusy, setAiBusy] = useState<"suggest" | "parse" | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [improvedByAi, setImprovedByAi] = useState(false);

  // Load tags, and (edit mode) the question to prefill.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listTags(),
      isEdit && id ? getQuestion(id) : Promise.resolve(null),
    ])
      .then(([tagList, question]) => {
        if (cancelled) return;
        setTags(tagList);
        if (question) {
          setStem(question.stem);
          setType(question.type);
          setOptions(question.options);
          setCorrect(question.correct);
          setKnowledgeSummary(question.knowledge_summary ?? "");
          setSelectedTagIds(question.tags.map((t) => t.id));
        } else if (ocrPrefill) {
          setStem(ocrPrefill.stem);
          setType(ocrPrefill.type);
          if (ocrPrefill.options.length > 0) setOptions(ocrPrefill.options);
          setCorrect([]); // OCR can't know the answer — user picks it
          setSource("ocr");
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Network error",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, isEdit, ocrPrefill]);

  function changeType(next: QuestionType) {
    setType(next);
    if (next === "judge") {
      setOptions(JUDGE_OPTIONS);
      setCorrect([]);
    } else if (type === "judge") {
      // Leaving judge: T/F no longer make sense — reset.
      setOptions([
        { label: "A", content: "" },
        { label: "B", content: "" },
      ]);
      setCorrect([]);
    } else if (next === "single") {
      // multi -> single: keep at most one correct.
      setCorrect((c) => c.slice(0, 1));
    }
  }

  function setOptionContent(label: string, content: string) {
    setOptions((os) =>
      os.map((o) => (o.label === label ? { ...o, content } : o)),
    );
  }

  function addOption() {
    setOptions((os) => [...os, { label: nextLabel(os), content: "" }]);
  }

  function removeOption(label: string) {
    setOptions((os) => os.filter((o) => o.label !== label));
    setCorrect((c) => c.filter((l) => l !== label));
  }

  function toggleCorrect(label: string) {
    if (type === "multi") {
      setCorrect((c) =>
        c.includes(label) ? c.filter((l) => l !== label) : [...c, label],
      );
    } else {
      // single / judge: exactly one
      setCorrect([label]);
    }
  }

  // Mirror the backend cross-field rules so the button reflects validity.
  const validity = useMemo(() => {
    if (!stem.trim()) return "Stem is required.";
    if (options.length === 0) return "At least one option is required.";
    if (options.some((o) => !o.content.trim()))
      return "Every option needs content.";
    const labels = options.map((o) => o.label);
    if (new Set(labels).size !== labels.length)
      return "Option labels must be unique.";
    if (correct.some((c) => !labels.includes(c)))
      return "A correct label is not among the options.";
    if (type === "single" && correct.length !== 1)
      return "Single-choice needs exactly one correct option.";
    if (type === "multi" && correct.length < 1)
      return "Multiple-choice needs at least one correct option.";
    if (type === "judge" && correct.length !== 1)
      return "Judge needs exactly one correct option.";
    return null;
  }, [stem, options, correct, type]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        stem: stem.trim(),
        type,
        options: options.map((o) => ({
          label: o.label,
          content: o.content.trim(),
        })),
        correct,
        knowledge_summary: knowledgeSummary.trim() || null,
        tag_ids: selectedTagIds,
        source,
      };
      if (isEdit && id) {
        await updateQuestion(id, payload);
      } else {
        await createQuestion(payload);
      }
      navigate("/questions");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // Options the AI tasks should see: trimmed, empties dropped (the
  // backend OptionIn rejects empty content with a 422).
  function aiOptionsPayload(): Option[] {
    return options
      .map((o) => ({ label: o.label, content: o.content.trim() }))
      .filter((o) => o.content.length > 0);
  }

  // "AI: suggest tags + summary" — fills editable fields the user then
  // reviews; only pre-selects from the user's OWN tags (server-resolved).
  async function onAiSuggest() {
    if (!stem.trim() || aiBusy) return;
    setAiError(null);
    setAiNote(null);
    setAiBusy("suggest");
    try {
      const opts = aiOptionsPayload();
      const hadSummary = knowledgeSummary.trim().length > 0;
      const [tg, ks] = await Promise.all([
        suggestTags(stem.trim(), opts),
        aiKnowledgeSummary(stem.trim(), opts),
      ]);
      if (tg.tags.length) {
        const ids = tg.tags.map((t) => t.id);
        setSelectedTagIds((cur) => Array.from(new Set([...cur, ...ids])));
      }
      const s = ks.summary.trim();
      if (s) setKnowledgeSummary(s);
      const notes: string[] = [];
      if (tg.tags.length)
        notes.push(`tags ${tg.tags.map((t) => t.name).join(", ")}`);
      if (s) notes.push(hadSummary ? "summary replaced" : "summary filled");
      setAiNote(
        notes.length
          ? `AI suggested ${notes.join("; ")} — review before saving.`
          : "AI had no suggestion for this question.",
      );
    } catch (err: unknown) {
      setAiError(err instanceof ApiError ? err.message : "AI request failed");
    } finally {
      setAiBusy(null);
    }
  }

  // "Improve with AI" — re-derive the question from the original crop +
  // OCR text via the vision endpoint. Repopulates editable fields; the
  // answer is never inferred (OCR/AI can't know it).
  async function onImproveWithAI() {
    const img = ocrPrefill?.imageB64;
    if (!img || aiBusy) return;
    setAiError(null);
    setAiNote(null);
    setAiBusy("parse");
    try {
      const r = await parseQuestion(img, ocrPrefill?.ocrText ?? "");
      setStem(r.stem);
      setType(r.type);
      setOptions(
        r.options.length > 0
          ? r.options
          : [
              { label: "A", content: "" },
              { label: "B", content: "" },
            ],
      );
      setCorrect([]);
      setImprovedByAi(true);
      setAiNote(
        "Reparsed from the screenshot — verify options & LaTeX, then " +
          "pick the correct answer.",
      );
    } catch (err: unknown) {
      setAiError(err instanceof ApiError ? err.message : "AI request failed");
    } finally {
      setAiBusy(null);
    }
  }

  // ─── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <style>{`
          @keyframes qfp-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
          .qfp-caret { animation: qfp-blink 1.05s steps(2, end) infinite; display: inline-block; }
          @media (prefers-reduced-motion: reduce) {
            .qfp-caret { animation: none !important; }
          }
        `}</style>
        <div
          className="rounded-sm border border-slate-200 bg-white p-5"
          style={{ fontFamily: SANS_FONT }}
        >
          <p
            className="text-[12px] text-slate-600"
            style={{ fontFamily: MONO_FONT }}
          >
            &gt; awaiting response&hellip;
            <span
              aria-hidden
              className="qfp-caret ml-1 inline-block h-[12px] w-[6px] align-middle"
              style={{ backgroundColor: "#60A5FA" }}
            />
          </p>
        </div>
      </>
    );
  }

  const isJudge = type === "judge";
  const showImproveCTA =
    ocrPrefill?.imageB64 &&
    (!ocrPrefill.matched || looksLikeFormula(stem));
  const submitLabel = submitting
    ? "PERSISTING…"
    : isEdit
      ? "↵ SAVE CHANGES"
      : "↵ CREATE";

  return (
    <>
      {/* Single keyframe block — caret blink + reduced-motion guard. */}
      <style>{`
        @keyframes qfp-blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        .qfp-caret { animation: qfp-blink 1.05s steps(2, end) infinite; display: inline-block; }
        @media (prefers-reduced-motion: reduce) {
          .qfp-caret { animation: none !important; }
        }
      `}</style>

      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        style={{ fontFamily: SANS_FONT }}
      >
        {/* ============================================================
            EDITOR PANEL
            ============================================================ */}
        <div className="rounded-sm border border-slate-200 bg-white p-5">
          {/* Eyebrow + title + mono subtitle */}
          <div>
            <div className={EYEBROW_CLS} style={{ fontFamily: MONO_FONT }}>
              MODULE / QUESTION
            </div>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-[#0A2540]">
              {isEdit ? "Edit question" : "New question"}
            </h1>
            <div
              className="mt-1 font-mono text-[11.5px] text-slate-600"
              style={{ fontFamily: MONO_FONT }}
            >
              {isEdit && id
                ? `editing record Q-${id.slice(0, 6)}`
                : "awaiting first save"}
            </div>
          </div>

          {/* OCR-draft notice — sapphire-50 panel, sharp 2px corners */}
          {source === "ocr" && (
            <div
              className="mt-4 rounded-sm border border-[#1E3A8A]/15 bg-[#EFF6FF] px-3 py-2 text-[12px] text-[#0A2540]"
            >
              <span
                className="font-mono text-[#0B3B8C]"
                style={{ fontFamily: MONO_FONT }}
              >
                [ OCR-DRAFT ]
              </span>
              <span
                className="mx-1 font-mono text-slate-400"
                style={{ fontFamily: MONO_FONT }}
              >
                ·
              </span>
              <span>Draft from OCR — review every field before saving.</span>
              {ocrPrefill && !ocrPrefill.matched && !improvedByAi && (
                <span
                  className="mt-1 block font-mono text-[11.5px] text-slate-600"
                  style={{ fontFamily: MONO_FONT }}
                >
                  <span aria-hidden className="mr-1">⚠</span>
                  Couldn&apos;t auto-split the options — separate them
                  manually, or click{" "}
                  <span className="text-[#0B3B8C]">Improve with AI</span>{" "}
                  below.
                </span>
              )}
              {improvedByAi && (
                <span
                  className="mt-1 block font-mono text-[11.5px] text-[#1E3A8A]"
                  style={{ fontFamily: MONO_FONT }}
                >
                  Reparsed with AI — verify the options &amp; LaTeX, then
                  pick the answer.
                </span>
              )}
            </div>
          )}

          {/* Type select with custom chevron */}
          <div className="mt-5">
            <label className={LABEL_CLS} style={{ fontFamily: MONO_FONT }}>
              TYPE
            </label>
            <div className="relative mt-1">
              <select
                value={type}
                onChange={(e) => changeType(e.target.value as QuestionType)}
                className={
                  INPUT_CLS +
                  " appearance-none pr-9 cursor-pointer"
                }
                style={{ fontFamily: SANS_FONT }}
              >
                <option value="single">Single choice</option>
                <option value="multi">Multiple choice</option>
                <option value="judge">Judge (True / False)</option>
              </select>
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
            </div>
          </div>

          {/* Stem */}
          <div className="mt-5">
            <label className={LABEL_CLS} style={{ fontFamily: MONO_FONT }}>
              STEM (LATEX WITH $…$)
            </label>
            <textarea
              value={stem}
              onChange={(e) => setStem(e.target.value)}
              rows={3}
              className={INPUT_CLS + " mt-1 resize-y"}
              placeholder="e.g. The derivative of $x^2$ is …"
            />
          </div>

          {/* Options header */}
          <div className="mt-5 flex items-center justify-between">
            <div>
              <div className={LABEL_CLS} style={{ fontFamily: MONO_FONT }}>
                OPTIONS
              </div>
              <div
                className="mt-0.5 font-mono text-[11px] text-slate-400"
                style={{ fontFamily: MONO_FONT }}
              >
                {isJudge
                  ? "radio = correct"
                  : type === "multi"
                    ? "checkbox = correct"
                    : "radio = correct"}
              </div>
            </div>
            {!isJudge && (
              <button
                type="button"
                onClick={addOption}
                className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-600 transition-colors duration-120 hover:border-[#2563EB] hover:text-[#0B3B8C]"
                style={{ fontFamily: MONO_FONT }}
              >
                <Plus size={12} strokeWidth={1.5} />
                ADD OPTION
              </button>
            )}
          </div>

          {/* Options list — each row is a sharp hairline panel */}
          <div className="mt-2 space-y-2">
            {options.map((o) => {
              const isCorrect = correct.includes(o.label);
              return (
                <div
                  key={o.label}
                  className={
                    "flex items-center gap-3 rounded-sm border bg-white px-2.5 py-2 transition-colors duration-120 " +
                    (isCorrect
                      ? "border-[#1E3A8A]/30 bg-[#EFF6FF]"
                      : "border-slate-200")
                  }
                >
                  <input
                    type={type === "multi" ? "checkbox" : "radio"}
                    name="correct"
                    checked={isCorrect}
                    onChange={() => toggleCorrect(o.label)}
                    aria-label={`Mark ${o.label} correct`}
                    className="h-3.5 w-3.5 cursor-pointer"
                    style={{ accentColor: "#1E3A8A" }}
                  />
                  <span
                    className={
                      "w-6 font-mono text-[12px] font-medium uppercase " +
                      (isCorrect ? "text-[#0B3B8C]" : "text-slate-500")
                    }
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {o.label}.
                  </span>
                  <input
                    value={o.content}
                    onChange={(e) =>
                      setOptionContent(o.label, e.target.value)
                    }
                    disabled={isJudge}
                    className="flex-1 rounded-sm border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-colors duration-120 focus:border-[#1E3A8A] disabled:bg-slate-50 disabled:text-slate-500"
                    placeholder="Option content (LaTeX ok)"
                  />
                  {!isJudge && options.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeOption(o.label)}
                      aria-label={`Remove option ${o.label}`}
                      title="Remove option"
                      className="flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-120 hover:border-[#DC2626] hover:text-[#DC2626]"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Knowledge summary */}
          <div className="mt-5">
            <label className={LABEL_CLS} style={{ fontFamily: MONO_FONT }}>
              KNOWLEDGE SUMMARY (OPTIONAL)
            </label>
            <textarea
              value={knowledgeSummary}
              onChange={(e) => setKnowledgeSummary(e.target.value)}
              rows={2}
              className={INPUT_CLS + " mt-1 resize-y"}
            />
          </div>

          {/* Tags */}
          <div className="mt-5">
            <label className={LABEL_CLS} style={{ fontFamily: MONO_FONT }}>
              TAGS
            </label>
            <div className="mt-1">
              <TagPicker
                tags={tags}
                selectedIds={selectedTagIds}
                onChangeSelected={setSelectedTagIds}
                onTagCreated={async () => {
                  try {
                    const fresh = await listTags();
                    setTags(fresh);
                  } catch {
                    /* a refresh failure is non-fatal */
                  }
                }}
              />
            </div>
          </div>

          {/* ---- AI helper panel ------------------------------------- */}
          <div className="mt-6 rounded-sm border border-[#1E3A8A] bg-[#EFF6FF] p-3">
            <div
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0B3B8C]"
              style={{ fontFamily: MONO_FONT }}
            >
              <Sparkles size={11} strokeWidth={1.5} />
              AI ASSISTANT
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAiSuggest}
                disabled={aiBusy !== null || !stem.trim()}
                className="inline-flex items-center gap-1.5 rounded-sm border border-[#1E3A8A]/30 bg-white px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[#0B3B8C] transition-colors duration-120 hover:border-[#1E3A8A] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{ fontFamily: MONO_FONT }}
              >
                {aiBusy === "suggest" ? (
                  <>
                    ASKING AI
                    <span
                      aria-hidden
                      className="qfp-caret ml-0.5 inline-block h-[10px] w-[5px] align-middle"
                      style={{ backgroundColor: "#0B3B8C" }}
                    />
                  </>
                ) : (
                  <>AI: SUGGEST TAGS + SUMMARY</>
                )}
              </button>

              {ocrPrefill?.imageB64 && (
                <button
                  type="button"
                  onClick={onImproveWithAI}
                  disabled={aiBusy !== null}
                  className={
                    "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors duration-120 disabled:cursor-not-allowed disabled:opacity-60 " +
                    (showImproveCTA
                      ? "border-[#1E3A8A] bg-[#DBEAFE] text-[#0B3B8C] hover:bg-[#EFF6FF]"
                      : "border-[#1E3A8A]/30 bg-white text-[#0B3B8C] hover:border-[#1E3A8A]")
                  }
                  style={{ fontFamily: MONO_FONT }}
                >
                  {aiBusy === "parse" ? (
                    <>
                      IMPROVING
                      <span
                        aria-hidden
                        className="qfp-caret ml-0.5 inline-block h-[10px] w-[5px] align-middle"
                        style={{ backgroundColor: "#0B3B8C" }}
                      />
                    </>
                  ) : (
                    <>IMPROVE WITH AI</>
                  )}
                </button>
              )}

              <span
                className="font-mono text-[10.5px] text-slate-500"
                style={{ fontFamily: MONO_FONT }}
              >
                Runs only when clicked — uses your daily AI quota.
              </span>
            </div>

            {aiNote && (
              <p
                className="mt-2 font-mono text-[11.5px] text-[#1E3A8A]"
                style={{ fontFamily: MONO_FONT }}
              >
                {aiNote}
              </p>
            )}
            {aiError && (
              <p
                className="mt-2 font-mono text-[11.5px] text-red-700"
                style={{ fontFamily: MONO_FONT }}
              >
                <span className="mr-1">[ AI ] ·</span>
                {aiError}
              </p>
            )}
          </div>

          {/* Validity (mono, sapphire-800) */}
          {validity && (
            <p
              className="mt-3 font-mono text-[11.5px] text-[#1E3A8A]"
              style={{ fontFamily: MONO_FONT }}
            >
              <span className="mr-1">[ VALIDATION ] ·</span>
              {validity}
            </p>
          )}

          {/* Error box (sharp red panel) */}
          {error && (
            <div
              className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700"
              style={{ fontFamily: MONO_FONT }}
            >
              <span className="mr-1">[ ERROR ] ·</span>
              {error}
            </div>
          )}

          {/* Submit / cancel */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={submitting || validity !== null}
              className="inline-flex items-center gap-1.5 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-4 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-white transition-colors duration-120 hover:bg-[#0B3B8C] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ fontFamily: MONO_FONT }}
            >
              {submitting ? (
                <>
                  {submitLabel}
                  <span
                    aria-hidden
                    className="qfp-caret ml-0.5 inline-block h-[11px] w-[5px] align-middle"
                    style={{ backgroundColor: "#FFFFFF" }}
                  />
                </>
              ) : (
                <>
                  <CornerDownLeft size={12} strokeWidth={1.5} />
                  {isEdit ? "SAVE CHANGES" : "CREATE"}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate("/questions")}
              className="inline-flex items-center rounded-sm border border-slate-200 bg-white px-3 py-2 font-mono text-[11.5px] uppercase tracking-[0.12em] text-slate-600 transition-colors duration-120 hover:border-[#2563EB] hover:text-[#0B3B8C]"
              style={{ fontFamily: MONO_FONT }}
            >
              ESC CANCEL
            </button>
          </div>
        </div>

        {/* ============================================================
            PREVIEW PANEL
            ============================================================ */}
        <div className="rounded-sm border border-slate-200 bg-white p-5">
          <div className={EYEBROW_CLS} style={{ fontFamily: MONO_FONT }}>
            MODULE / PREVIEW
          </div>
          <div
            className="mt-1 font-mono text-[11.5px] text-slate-600"
            style={{ fontFamily: MONO_FONT }}
          >
            &gt; live LaTeX render
          </div>

          {/* Stem rendering — unchanged Latex usage */}
          <div className="mt-4 text-[14px] text-slate-900">
            <Latex text={stem || "(stem preview)"} />
          </div>

          {/* Options preview — mono [CORRECT] flag, no green */}
          <ul className="mt-4 space-y-1.5">
            {options.map((o) => {
              const isCorrect = correct.includes(o.label);
              return (
                <li
                  key={o.label}
                  className="flex items-start gap-2 text-[13.5px]"
                >
                  <span
                    className={
                      "font-mono text-[12px] " +
                      (isCorrect
                        ? "font-semibold text-[#1E3A8A]"
                        : "text-slate-500")
                    }
                    style={{ fontFamily: MONO_FONT }}
                  >
                    {o.label}.
                  </span>
                  <span className="flex-1 text-slate-900">
                    <Latex text={o.content || "(empty)"} />
                  </span>
                  {isCorrect && (
                    <span
                      className="ml-1 inline-flex shrink-0 items-center rounded-sm border border-[#1E3A8A]/30 bg-[#DBEAFE] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[#0B3B8C]"
                      style={{ fontFamily: MONO_FONT }}
                    >
                      [CORRECT]
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Knowledge summary panel */}
          {knowledgeSummary.trim() && (
            <div className="mt-5 rounded-sm border border-[#1E3A8A]/15 bg-[#EFF6FF] px-3 py-2.5">
              <div
                className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0B3B8C]"
                style={{ fontFamily: MONO_FONT }}
              >
                <Lightbulb size={11} strokeWidth={1.5} />
                KNOWLEDGE SUMMARY
              </div>
              <div className="mt-1.5 text-[13px] text-slate-900">
                <Latex text={knowledgeSummary} />
              </div>
            </div>
          )}
        </div>
      </form>
    </>
  );
}
