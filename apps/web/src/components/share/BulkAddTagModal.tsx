// Bulk "add tags" modal. Wraps the existing TagPicker so the user can
// pick (or create) one or more tags; Apply unions them into every
// selected question's existing tag set via POST /questions/bulk-tags.
// Append-only — no remove-tag mode (spec §2.9).
//
// Visual: Sapphire Console — backdrop blur, sharp 2px panel, mono
// eyebrow + sans heading, sapphire-active primary, ghost cancel.

import { useState } from "react";
import { X } from "lucide-react";
import { ApiError } from "../../lib/api";
import { bulkAddTags, listTags, type Tag } from "../../lib/qbank";
import TagPicker from "../tags/TagPicker";

interface Props {
  questionIds: string[];
  initialTags: Tag[];
  onClose: () => void;
  /** Called after Apply succeeds so the parent can refetch the list. */
  onApplied: () => void;
}

export default function BulkAddTagModal({
  questionIds,
  initialTags,
  onClose,
  onApplied,
}: Props) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refetchTags() {
    try {
      const t = await listTags();
      setTags(t);
    } catch {
      /* a failed refetch shouldn't block the apply flow */
    }
  }

  async function onApply() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await bulkAddTags(questionIds, picked);
      onApplied();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-sm border border-slate-200 bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              [ BULK TAG ]
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[#0A2540]">
              Add tags to {questionIds.length} question
              {questionIds.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              picked tags are <span className="text-[#0B3B8C]">added</span>{" "}
              (union) — no replacement.
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

        <div className="mt-3 flex-1 overflow-y-auto">
          <TagPicker
            tags={tags}
            selectedIds={picked}
            onChangeSelected={setPicked}
            onTagCreated={refetchTags}
          />
        </div>
        {error && (
          <div className="mt-3 rounded-sm border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
            [ ERROR ] · {error}
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
            onClick={onApply}
            disabled={picked.length === 0 || busy}
            className="rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:opacity-50 disabled:hover:bg-[#1E3A8A]"
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
