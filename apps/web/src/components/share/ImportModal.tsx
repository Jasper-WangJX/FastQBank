// Two-step import flow:
//   1. Paste textarea → extract a 12-char share token.
//   2. GET /shares/{token} → render a compact preview (stems truncated
//      to 80 chars, no LaTeX render for cheapness) + tag summary.
//   3. POST /shares/{token}/import → toast counters; parent refetches.
//
// Error → inline message in the modal (no toast):
//   404 → "Link not found."
//   410 → "This link has been revoked."
//   422 → "Couldn't read this link's contents."
//   other → "Network error — retry?"
//
// Visual: Sapphire Console — sharp 2px panel, dashed sapphire drop zone
// for the paste input, mono prompt + mono error prefix.

import { useState } from "react";
import { X } from "lucide-react";
import { ApiError } from "../../lib/api";
import {
  getSharePreview,
  importShare,
  listTags,
  type SharePreviewOut,
} from "../../lib/qbank";
import { extractShareToken } from "../../lib/shareToken";

interface Props {
  onClose: () => void;
  /** Called after Import succeeds with the counter summary so the
   * parent can toast and refetch. */
  onImported: (msg: string) => void;
}

function errorFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "Link not found.";
    if (err.status === 410) return "This link has been revoked.";
    if (err.status === 422) return "Couldn't read this link's contents.";
    return err.message || "Network error — retry?";
  }
  return "Network error — retry?";
}

export default function ImportModal({ onClose, onImported }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SharePreviewOut | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  // Tag reuse/create counts vs. the current user's existing tags
  const [tagCounts, setTagCounts] = useState<{
    total: number;
    reuse: number;
    create: number;
  } | null>(null);

  const token = extractShareToken(raw);

  async function onNext() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [p, myTags] = await Promise.all([
        getSharePreview(token),
        listTags(),
      ]);
      const allNames = new Set<string>();
      for (const q of p.payload.questions) {
        for (const n of q.tag_names) allNames.add(n);
      }
      const mine = new Set(myTags.map((t) => t.name));
      let reuse = 0;
      let create = 0;
      for (const n of allNames) {
        if (mine.has(n)) reuse += 1;
        else create += 1;
      }
      setPreview(p);
      setPreviewToken(token);
      setTagCounts({ total: allNames.size, reuse, create });
    } catch (err: unknown) {
      setError(errorFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!previewToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importShare(previewToken);
      const summary =
        `Imported ${r.imported} · Skipped ${r.skipped} · ` +
        `Tags reused ${r.tags_reused}, created ${r.tags_created}`;
      onImported(summary);
      onClose();
    } catch (err: unknown) {
      setError(errorFor(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-sm border border-slate-200 bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              [ IMPORT ]
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[#0A2540]">
              Import from share link
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              {preview === null
                ? "paste a share link (or a 12-character token)."
                : `${preview.payload.questions.length} question${preview.payload.questions.length === 1 ? "" : "s"}${
                    tagCounts && tagCounts.total > 0
                      ? ` · ${tagCounts.total} tag${tagCounts.total === 1 ? "" : "s"} (${tagCounts.reuse} reused, ${tagCounts.create} new)`
                      : ""
                  }`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            disabled={busy}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        {preview === null ? (
          <>
            {/* Sharp-cornered drop-zone-style wrapper around the textarea */}
            <div className="mt-3 rounded-sm border border-dashed border-[#DBEAFE] bg-[#EFF6FF]/30 p-2 transition-colors duration-150 focus-within:border-[#1E3A8A] focus-within:bg-white">
              <div className="px-1 pb-1 font-mono text-[10.5px] text-slate-500">
                &gt; drop a share link here or paste below
              </div>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="https://fastqbank.com/s/…"
                rows={3}
                className="w-full rounded-sm border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1E3A8A]"
              />
            </div>
            {raw.trim().length > 0 && token === null && (
              <p className="mt-1 font-mono text-[10.5px] text-[#DC2626]">
                [ IMPORT ] · couldn't find a share token in this text.
              </p>
            )}
            {error && (
              <div className="mt-3 rounded-sm border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
                [ IMPORT ] · {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-sm border border-slate-200 bg-white px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-slate-600 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!token || busy}
                className="rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:opacity-50 disabled:hover:bg-[#1E3A8A]"
              >
                {busy ? "Loading…" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex-1 divide-y divide-slate-100 overflow-y-auto rounded-sm border border-slate-200">
              {preview.payload.questions.map((q) => (
                <div key={q.source_id} className="px-3 py-2 text-sm">
                  <div className="line-clamp-1 text-[13px] text-slate-900">
                    {q.stem.length > 80
                      ? q.stem.slice(0, 80) + "…"
                      : q.stem}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="inline-flex h-[18px] items-center rounded-sm border border-[#0B3B8C]/15 bg-[#DBEAFE] px-1.5 font-mono text-[10px] font-medium uppercase tracking-tight text-[#1E3A8A]">
                      {q.type}
                    </span>
                    {q.tag_names.map((n) => (
                      <span
                        key={n}
                        className="inline-flex h-[18px] items-center rounded-sm border border-slate-200 bg-slate-50 px-1.5 font-mono text-[10px] text-slate-600"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-sm border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
                [ IMPORT ] · {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-sm border border-slate-200 bg-white px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-slate-600 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onImport}
                disabled={busy}
                className="rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:opacity-50 disabled:hover:bg-[#1E3A8A]"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
