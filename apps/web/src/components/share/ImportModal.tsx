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

import { useState } from "react";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Import from share link</h2>

        {preview === null ? (
          <>
            <p className="mt-1 text-sm text-gray-600">
              Paste a share link (or a 12-character token).
            </p>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="https://fastqbank.com/s/…"
              rows={3}
              className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            {raw.trim().length > 0 && token === null && (
              <p className="mt-1 text-xs text-red-700">
                Couldn't find a share token in this text.
              </p>
            )}
            {error && (
              <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onNext}
                disabled={!token || busy}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? "Loading…" : "Next"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">
              {preview.payload.questions.length} question
              {preview.payload.questions.length === 1 ? "" : "s"}
              {tagCounts && tagCounts.total > 0 && (
                <>
                  {" · "}
                  {tagCounts.total} tag{tagCounts.total === 1 ? "" : "s"}{" "}
                  ({tagCounts.reuse} reused, {tagCounts.create} new)
                </>
              )}
            </p>
            <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100">
              {preview.payload.questions.map((q) => (
                <div key={q.source_id} className="px-3 py-2 text-sm">
                  <div className="line-clamp-1 text-gray-800">
                    {q.stem.length > 80
                      ? q.stem.slice(0, 80) + "…"
                      : q.stem}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                      {q.type}
                    </span>
                    {q.tag_names.map((n) => (
                      <span
                        key={n}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onImport}
                disabled={busy}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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
