// Hierarchical tag panel: (a) click a tag to FILTER (single active, with
// an "All" row to clear), (b) full management on each node — rename,
// add child, move, delete subtree — plus create-root. Used by
// QuestionListPage (Phase 7.1: tag management lives with the question
// bank; the standalone /tags page was removed). After any mutation it
// re-fetches via the injected onChanged() so the parent reloads the
// question list too (a deleted tag changes what questions match).

import { useMemo, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  createTag,
  deleteTag,
  moveTag,
  renameTag,
  type Tag,
} from "../../lib/qbank";
import { byParent, depthOf, inSubtree, sortByPath } from "./tagTree";

interface Props {
  tags: Tag[];
  /** Currently active filter tag id, or null = "All" (no filter). */
  activeTagId: string | null;
  onSelect: (tagId: string | null) => void;
  /** Called after a successful create/rename/move/delete so the parent
   *  can re-fetch tags (and re-fetch the question list). */
  onChanged: () => Promise<void> | void;
}

export default function TagManagePanel({
  tags,
  activeTagId,
  onSelect,
  onChanged,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newRootName, setNewRootName] = useState("");
  const [addChildFor, setAddChildFor] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function resetTransient() {
    setAddChildFor(null);
    setChildName("");
    setRenamingId(null);
    setRenameValue("");
    setNewRootName("");
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onChanged();
      resetTransient();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => byParent(tags), [tags]);

  function moveOptions(node: Tag) {
    return sortByPath(tags.filter((t) => !inSubtree(t, node)));
  }

  function renderNode(tag: Tag) {
    const depth = depthOf(tag);
    const children = grouped.get(tag.id) ?? [];
    const isRenaming = renamingId === tag.id;
    const isAddingChild = addChildFor === tag.id;
    const active = activeTagId === tag.id;

    return (
      <div key={tag.id}>
        <div
          className="flex items-center gap-2 border-b border-gray-100 py-1.5"
          style={{ paddingLeft: depth * 20 }}
        >
          {isRenaming ? (
            <>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
              />
              <button
                disabled={busy || !renameValue.trim()}
                onClick={() =>
                  run(() => renameTag(tag.id, renameValue.trim()))
                }
                className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                disabled={busy}
                onClick={resetTransient}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onSelect(tag.id)}
                className={
                  "rounded px-2 py-0.5 text-sm " +
                  (active
                    ? "bg-slate-800 text-white"
                    : "text-gray-700 hover:bg-gray-100")
                }
              >
                {tag.name}
              </button>
              <select
                aria-label={`Move ${tag.name}`}
                disabled={busy}
                value={tag.parent_id ?? ""}
                onChange={(e) =>
                  run(() =>
                    moveTag(
                      tag.id,
                      e.target.value === "" ? null : e.target.value,
                    ),
                  )
                }
                className="ml-1 rounded-md border border-gray-300 px-1 py-0.5 text-xs"
              >
                <option value="">(root)</option>
                {moveOptions(tag).map((t) => (
                  <option key={t.id} value={t.id}>
                    {" ".repeat(depthOf(t) * 2)}
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => {
                  setRenamingId(tag.id);
                  setRenameValue(tag.name);
                }}
                className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                Rename
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setAddChildFor(tag.id);
                  setChildName("");
                }}
                className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                + Child
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${tag.name}" and its whole subtree? ` +
                        `Questions are kept but lose these tags.`,
                    )
                  ) {
                    run(async () => {
                      await deleteTag(tag.id);
                      if (active) onSelect(null);
                    });
                  }
                }}
                className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>

        {isAddingChild && (
          <div
            className="flex items-center gap-2 py-1.5"
            style={{ paddingLeft: (depth + 1) * 20 }}
          >
            <input
              autoFocus
              placeholder="New child tag name"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
            />
            <button
              disabled={busy || !childName.trim()}
              onClick={() =>
                run(() =>
                  createTag({ name: childName.trim(), parent_id: tag.id }),
                )
              }
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              disabled={busy}
              onClick={resetTransient}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}

        {children.map((c) => renderNode(c))}
      </div>
    );
  }

  const roots = grouped.get(null) ?? [];

  return (
    <div className="rounded-md border border-gray-200 p-2">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => onSelect(null)}
          className={
            "rounded px-2 py-1 text-sm font-medium " +
            (activeTagId === null
              ? "bg-slate-800 text-white"
              : "text-gray-700 hover:bg-gray-100")
          }
        >
          All tags
        </button>
        <input
          placeholder="New root tag"
          value={newRootName}
          onChange={(e) => setNewRootName(e.target.value)}
          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
        />
        <button
          disabled={busy || !newRootName.trim()}
          onClick={() => run(() => createTag({ name: newRootName.trim() }))}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Add root
        </button>
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-red-400 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}

      {roots.length === 0 ? (
        <p className="px-1 text-xs text-gray-400">
          No tags yet — add a root tag above.
        </p>
      ) : (
        roots.map((r) => renderNode(r))
      )}
    </div>
  );
}
