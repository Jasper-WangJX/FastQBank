// Create / edit a question. One component, two modes (presence of :id).
// Client-side rules mirror the backend QuestionIn validator, but the
// server's 422 is the source of truth and is surfaced in the error box.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  const isJudge = type === "judge";

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      {/* Editor */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">
          {isEdit ? "Edit question" : "New question"}
        </h1>

        {source === "ocr" && (
          <div className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Draft from OCR — review every field before saving.
            {ocrPrefill && !ocrPrefill.matched && !improvedByAi && (
              <span className="mt-1 block text-amber-700">
                Couldn&apos;t auto-split the options — separate them
                manually, or click <strong>Improve with AI</strong> below.
              </span>
            )}
            {improvedByAi && (
              <span className="mt-1 block text-emerald-700">
                Reparsed with AI — verify the options &amp; LaTeX, then
                pick the answer.
              </span>
            )}
          </div>
        )}

        <label className="mt-4 block text-sm font-medium text-gray-700">
          Type
        </label>
        <select
          value={type}
          onChange={(e) => changeType(e.target.value as QuestionType)}
          className="mt-1 rounded-md border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="single">Single choice</option>
          <option value="multi">Multiple choice</option>
          <option value="judge">Judge (True / False)</option>
        </select>

        <label className="mt-4 block text-sm font-medium text-gray-700">
          Stem (LaTeX with $…$)
        </label>
        <textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="e.g. The derivative of $x^2$ is …"
        />

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            Options{" "}
            <span className="font-normal text-gray-400">
              ({isJudge ? "radio" : type === "multi" ? "checkbox" : "radio"}{" "}
              = correct)
            </span>
          </span>
          {!isJudge && (
            <button
              type="button"
              onClick={addOption}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              + Option
            </button>
          )}
        </div>

        <div className="mt-2 space-y-2">
          {options.map((o) => (
            <div key={o.label} className="flex items-center gap-2">
              <input
                type={type === "multi" ? "checkbox" : "radio"}
                name="correct"
                checked={correct.includes(o.label)}
                onChange={() => toggleCorrect(o.label)}
                aria-label={`Mark ${o.label} correct`}
              />
              <span className="w-5 text-sm font-medium text-gray-600">
                {o.label}
              </span>
              <input
                value={o.content}
                onChange={(e) => setOptionContent(o.label, e.target.value)}
                disabled={isJudge}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500 disabled:bg-gray-50"
                placeholder="Option content (LaTeX ok)"
              />
              {!isJudge && options.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOption(o.label)}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium text-gray-700">
          Knowledge summary (optional)
        </label>
        <textarea
          value={knowledgeSummary}
          onChange={(e) => setKnowledgeSummary(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />

        <label className="mt-4 block text-sm font-medium text-gray-700">
          Tags
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

        {/* Stage-6 AI helpers — on-demand only, never automatic. */}
        <div className="mt-5 rounded-md border border-violet-200 bg-violet-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onAiSuggest}
              disabled={aiBusy !== null || !stem.trim()}
              className="rounded-md border border-violet-400 bg-white px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50"
            >
              {aiBusy === "suggest"
                ? "Asking AI…"
                : "AI: suggest tags + summary"}
            </button>
            {ocrPrefill?.imageB64 && (
              <button
                type="button"
                onClick={onImproveWithAI}
                disabled={aiBusy !== null}
                className={
                  "rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 " +
                  (!ocrPrefill.matched || looksLikeFormula(stem)
                    ? "border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200"
                    : "border-violet-400 bg-white text-violet-800 hover:bg-violet-100")
                }
              >
                {aiBusy === "parse" ? "Improving…" : "Improve with AI"}
              </button>
            )}
            <span className="text-[11px] text-gray-500">
              Runs only when clicked — uses your daily AI quota.
            </span>
          </div>
          {aiNote && (
            <p className="mt-2 text-xs text-violet-700">{aiNote}</p>
          )}
          {aiError && (
            <p className="mt-2 text-xs text-red-700">AI: {aiError}</p>
          )}
        </div>

        {validity && (
          <p className="mt-3 text-xs text-amber-600">{validity}</p>
        )}
        {error && (
          <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={submitting || validity !== null}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Create question"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/questions")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Live LaTeX preview */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">Preview</h2>
        <div className="mt-3 text-sm text-gray-900">
          <Latex text={stem || "(stem preview)"} />
        </div>
        <ul className="mt-4 space-y-1">
          {options.map((o) => (
            <li key={o.label} className="flex gap-2 text-sm">
              <span
                className={
                  correct.includes(o.label)
                    ? "font-semibold text-green-700"
                    : "text-gray-500"
                }
              >
                {o.label}.
              </span>
              <span className="text-gray-900">
                <Latex text={o.content || "(empty)"} />
              </span>
            </li>
          ))}
        </ul>
        {knowledgeSummary.trim() && (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            💡 <Latex text={knowledgeSummary} />
          </div>
        )}
      </div>
    </form>
  );
}
