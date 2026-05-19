// Right-side drawer that owns tag CRUD: rename / delete / create. The
// trigger button lives in the parent page (TagFilter). The drawer
// refetches tags on every successful mutation via the parent's
// onChanged callback. Selection chips in the parent are kept in sync
// only on close (deleted ids are filtered out then) — the drawer
// itself doesn't read selectedIds.

import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  createTag,
  deleteTag,
  renameTag,
  type Tag,
} from "../../lib/qbank";
import { sortByName } from "./sortByName";

interface Props {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  /** Called after each successful create/rename/delete so the parent
   *  page can refetch the tag list and the question list. */
  onChanged: () => Promise<void> | void;
}

export default function TagManageDrawer({
  open,
  onClose,
  tags,
  onChanged,
}: Props) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("");

  // Reset transient state when re-opening.
  useEffect(() => {
    if (open) {
      setQ("");
      setRenamingId(null);
      setRenameValue("");
      setNewName("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const needle = q.trim().toLowerCase();
  const filtered = sortByName(tags).filter(
    (t) => !needle || t.name.toLowerCase().includes(needle),
  );

  const trimmedNew = newName.trim();
  const newDuplicate =
    trimmedNew.length > 0 &&
    tags.some((t) => t.name.toLowerCase() === trimmedNew.toLowerCase());

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex"
      role="dialog"
      aria-label="Manage tags"
    >
      <div
        className="flex-1 bg-black/30"
        onClick={onClose}
      />
      <div className="flex h-full w-96 flex-col border-l border-gray-200 bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Manage tags</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
          >
            ✕
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tags…"
          className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
        />

        {error && (
          <p className="mt-2 rounded-md border border-red-400 bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </p>
        )}

        <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-gray-200">
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-xs text-gray-400">
              {tags.length === 0
                ? "No tags yet — add one below."
                : "No matching tags."}
            </p>
          ) : (
            filtered.map((t) => {
              const isRenaming = renamingId === t.id;
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm last:border-b-0"
                >
                  {isRenaming ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
                      />
                      <button
                        type="button"
                        disabled={busy || !renameValue.trim()}
                        onClick={() =>
                          run(async () => {
                            await renameTag(t.id, renameValue.trim());
                            setRenamingId(null);
                          })
                        }
                        className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRenamingId(null)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-gray-800">{t.name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Rename ${t.name}`}
                        title="Rename"
                        onClick={() => {
                          setRenamingId(t.id);
                          setRenameValue(t.name);
                        }}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Delete ${t.name}`}
                        title="Delete"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete "${t.name}"? Questions that used it lose this tag.`,
                            )
                          ) {
                            run(() => deleteTag(t.id));
                          }
                        }}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New tag name"
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="button"
            disabled={busy || !trimmedNew || newDuplicate}
            onClick={() =>
              run(async () => {
                await createTag({ name: trimmedNew });
                setNewName("");
              })
            }
            className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
            title={
              newDuplicate
                ? "Tag already exists"
                : undefined
            }
          >
            + Create
          </button>
        </div>
        {newDuplicate && (
          <p className="mt-1 text-xs text-amber-700">
            Tag already exists.
          </p>
        )}
      </div>
    </div>
  );
}
