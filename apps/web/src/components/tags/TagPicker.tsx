// Picker used by QuestionFormPage's Tags region. Like TagFilter (inline
// variant) but with no AND/OR toggle and with an inline "+ Create &
// select" row at the bottom. Stateless w.r.t. selection.

import { useMemo, useState } from "react";
import { ApiError } from "../../lib/api";
import { createTag, type Tag } from "../../lib/qbank";
import TagSearchList from "./TagSearchList";

interface Props {
  tags: Tag[];
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  /** Called after a successful create so the parent can refetch tags. */
  onTagCreated: (created: Tag) => Promise<void> | void;
}

export default function TagPicker({
  tags,
  selectedIds,
  onChangeSelected,
  onTagCreated,
}: Props) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    onChangeSelected(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  const trimmed = newName.trim();
  const duplicate = useMemo(
    () =>
      trimmed.length > 0 &&
      tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase()),
    [trimmed, tags],
  );

  async function onCreate() {
    if (!trimmed || duplicate || busy) return;
    if (
      !window.confirm(
        `Create tag "${trimmed}"? Tags can only be renamed or deleted from the Question Bank page.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createTag({ name: trimmed });
      onChangeSelected(
        selectedIds.includes(created.id)
          ? selectedIds
          : [...selectedIds, created.id],
      );
      setNewName("");
      await onTagCreated(created);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const selectedTags = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => Boolean(t));

  return (
    <div className="rounded-md border border-gray-200 p-2">
      {selectedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-gray-500">Selected:</span>
          {selectedTags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700"
            >
              {t.name}
              <button
                type="button"
                aria-label={`Remove ${t.name}`}
                onClick={() => toggle(t.id)}
                className="text-slate-500 hover:text-slate-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <TagSearchList
        tags={tags}
        selectedIds={selectedIds}
        onToggle={toggle}
        maxListHeight={200}
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag name"
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
        />
        <button
          type="button"
          disabled={!trimmed || duplicate || busy}
          onClick={onCreate}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          title={
            duplicate
              ? "Tag already exists — tick it in the list above"
              : undefined
          }
        >
          {busy ? "Creating…" : "+ Create & select"}
        </button>
      </div>
      {duplicate && (
        <p className="mt-1 text-xs text-amber-700">
          Tag already exists — tick it in the list above.
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
