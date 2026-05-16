// Tag hierarchy manager. The backend returns a FLAT list ordered by the
// id-based materialized path; the tree is rebuilt here. After every
// mutation we just re-fetch listTags() — at personal-use scale this is
// the simplest state that is always correct.

import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import {
  createTag,
  deleteTag,
  listTags,
  moveTag,
  renameTag,
  type Tag,
} from "../lib/qbank";

// Depth from the id-based path: root path = "<uuid>" (1 segment).
function depthOf(tag: Tag): number {
  return tag.path.split("/").length - 1;
}

function inSubtree(candidate: Tag, root: Tag): boolean {
  return (
    candidate.path === root.path ||
    candidate.path.startsWith(root.path + "/")
  );
}

export default function TagManagerPage() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Transient per-action UI state.
  const [newRootName, setNewRootName] = useState("");
  const [addChildFor, setAddChildFor] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function reload() {
    const data = await listTags();
    setTags(data);
  }

  useEffect(() => {
    let cancelled = false;
    listTags()
      .then((data) => {
        if (!cancelled) setTags(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Network error",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetTransient() {
    setAddChildFor(null);
    setChildName("");
    setRenamingId(null);
    setRenameValue("");
    setNewRootName("");
  }

  // Wrap a mutation: clear error, run, reload, reset inputs. A single
  // `busy` flag disables all actions meanwhile to avoid races.
  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await reload();
      resetTransient();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  // children grouped by parent_id, siblings sorted by name.
  const byParent = useMemo(() => {
    const m = new Map<string | null, Tag[]>();
    for (const t of tags ?? []) {
      const arr = m.get(t.parent_id) ?? [];
      arr.push(t);
      m.set(t.parent_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [tags]);

  function moveOptions(node: Tag) {
    // Every tag except the node's own subtree, in tree order, plus root.
    return (tags ?? [])
      .filter((t) => !inSubtree(t, node))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  function renderNode(tag: Tag) {
    const depth = depthOf(tag);
    const children = byParent.get(tag.id) ?? [];
    const isRenaming = renamingId === tag.id;
    const isAddingChild = addChildFor === tag.id;

    return (
      <div key={tag.id}>
        <div
          className="flex items-center gap-2 border-b border-gray-100 py-2"
          style={{ paddingLeft: depth * 22 }}
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
                onClick={() => {
                  setRenamingId(null);
                  setRenameValue("");
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">{tag.name}</span>

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
                className="ml-2 rounded-md border border-gray-300 px-1 py-1 text-xs"
              >
                <option value="">(root)</option>
                {moveOptions(tag).map((t) => (
                  <option key={t.id} value={t.id}>
                    {" ".repeat(depthOf(t) * 2)}
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
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
              >
                Rename
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setAddChildFor(tag.id);
                  setChildName("");
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
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
                    run(() => deleteTag(tag.id));
                  }
                }}
                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>

        {isAddingChild && (
          <div
            className="flex items-center gap-2 py-2"
            style={{ paddingLeft: (depth + 1) * 22 }}
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
                  createTag({
                    name: childName.trim(),
                    parent_id: tag.id,
                  }),
                )
              }
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setAddChildFor(null);
                setChildName("");
              }}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}

        {children
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => renderNode(c))}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tag management</h1>
      </div>

      {/* Create a root tag */}
      <div className="mt-4 flex items-center gap-2">
        <input
          placeholder="New root tag name"
          value={newRootName}
          onChange={(e) => setNewRootName(e.target.value)}
          className="w-64 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button
          disabled={busy || !newRootName.trim()}
          onClick={() =>
            run(() => createTag({ name: newRootName.trim() }))
          }
          className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Add root tag
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5">
        {tags === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : roots.length === 0 ? (
          <p className="text-sm text-gray-500">
            No tags yet. Create your first root tag above.
          </p>
        ) : (
          <div className="rounded-md border border-gray-200">
            {roots.map((r) => renderNode(r))}
          </div>
        )}
      </div>
    </div>
  );
}
