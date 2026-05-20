// Bulk "add tags" modal. Wraps the existing TagPicker so the user can
// pick (or create) one or more tags; Apply unions them into every
// selected question's existing tag set via POST /questions/bulk-tags.
// Append-only — no remove-tag mode (spec §2.9).

import { useState } from "react";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">
          Add tags to {questionIds.length} question
          {questionIds.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Picked tags are <strong>added</strong> to each question's existing
          tags (no replacement).
        </p>
        <div className="mt-3 flex-1 overflow-y-auto">
          <TagPicker
            tags={tags}
            selectedIds={picked}
            onChangeSelected={setPicked}
            onTagCreated={refetchTags}
          />
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
            onClick={onApply}
            disabled={picked.length === 0 || busy}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
