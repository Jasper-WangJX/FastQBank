// Picker used by QuestionFormPage's Tags region. Like TagFilter (inline
// variant) but with no AND/OR toggle and with an inline "+ Create &
// select" row at the bottom. Stateless w.r.t. selection.
//
// Visual: Sapphire Console — sharp 2px corners, mono chips + create CTA.

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
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
    <div className="rounded-sm border border-slate-200 bg-white p-2">
      {selectedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Selected:
          </span>
          {selectedTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-sm border border-[#0B3B8C]/15 bg-[#DBEAFE] px-1.5 py-0.5 font-mono text-[11px] text-[#1E3A8A]"
            >
              {t.name}
              <button
                type="button"
                aria-label={`Remove ${t.name}`}
                title={`Remove ${t.name}`}
                onClick={() => toggle(t.id)}
                className="inline-flex h-4 w-4 items-center justify-center text-[#0B3B8C]/70 hover:text-[#1E3A8A]"
              >
                <X size={11} strokeWidth={1.5} aria-hidden />
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
          onKeyDown={(e) => {
            // Enter inside this input must create the tag, NOT submit
            // the surrounding QuestionFormPage <form>. Without the
            // preventDefault, the browser fires the form's implicit
            // submit since this is the only text input that doesn't
            // already handle Enter.
            if (e.key === "Enter") {
              e.preventDefault();
              void onCreate();
            }
          }}
          placeholder="New tag name"
          className="flex-1 rounded-sm border border-slate-200 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 outline-none transition-colors duration-150 placeholder:text-slate-400 focus:border-[#1E3A8A]"
        />
        <button
          type="button"
          disabled={!trimmed || duplicate || busy}
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-tight text-slate-600 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:text-slate-600"
          title={
            duplicate
              ? "Tag already exists — tick it in the list above"
              : undefined
          }
        >
          <Plus size={12} strokeWidth={1.5} aria-hidden />
          {busy
            ? "Creating…"
            : trimmed
              ? `Create "${trimmed}"`
              : "Create"}
        </button>
      </div>
      {duplicate && (
        <p className="mt-1 font-mono text-[10.5px] text-slate-500">
          [ INFO ] · tag already exists — tick it above.
        </p>
      )}
      {error && (
        <p className="mt-1 font-mono text-[10.5px] text-[#DC2626]">
          [ ERROR ] · {error}
        </p>
      )}
    </div>
  );
}
