// Right-side drawer that owns tag CRUD: rename / delete / create. The
// trigger button lives in the parent page (TagFilter). The drawer
// refetches tags on every successful mutation via the parent's
// onChanged callback. Selection chips in the parent are kept in sync
// only on close (deleted ids are filtered out then) — the drawer
// itself doesn't read selectedIds.
//
// Visual: Sapphire Console — backdrop blur, sharp 2px panel, hairline
// borders, icon-based row actions, mono labels.

import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
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

  // Reset transient state when re-opening. The eslint rule flags
  // setState-in-effect as a cascading-render smell, but this is the
  // canonical pattern for "clear local form state when the drawer
  // becomes visible" — the alternative (a `key` on the parent) would
  // force the drawer to unmount/remount unnecessarily.
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setQ("");
      setRenamingId(null);
      setRenameValue("");
      setNewName("");
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
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
        className="flex-1 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="flex h-full w-96 flex-col rounded-none border-l border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              [ TAGS ]
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[#0A2540]">
              Manage tags
            </h2>
            <div className="mt-0.5 font-mono text-[11px] text-slate-500">
              {tags.length} tag{tags.length === 1 ? "" : "s"} · rename · delete
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C]"
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tags…"
          className="mt-3 w-full rounded-sm border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1E3A8A]"
        />

        {error && (
          <p className="mt-2 rounded-sm border border-[#DC2626]/40 bg-[#DC2626]/5 px-2 py-1 font-mono text-[11px] text-[#DC2626]">
            [ ERROR ] · {error}
          </p>
        )}

        <div className="mt-3 flex-1 overflow-y-auto rounded-sm border border-slate-200">
          {filtered.length === 0 ? (
            <p className="px-2 py-2 font-mono text-[11px] text-slate-400">
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
                  className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-sm last:border-b-0 hover:bg-[#EFF6FF]"
                >
                  {isRenaming ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter = confirm rename (same gate as the
                          // adjacent ✓ button: trimmed + not busy).
                          if (
                            e.key === "Enter" &&
                            !busy &&
                            renameValue.trim()
                          ) {
                            e.preventDefault();
                            void run(async () => {
                              await renameTag(t.id, renameValue.trim());
                              setRenamingId(null);
                            });
                          }
                        }}
                        className="flex-1 rounded-sm border border-slate-200 bg-white px-2 py-1 font-mono text-[12px] text-slate-900 outline-none focus:border-[#1E3A8A]"
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
                        aria-label="Save rename"
                        title="Save"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:opacity-50"
                      >
                        <Check size={13} strokeWidth={1.5} aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRenamingId(null)}
                        aria-label="Cancel rename"
                        title="Cancel"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
                      >
                        <X size={13} strokeWidth={1.5} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate font-mono text-[12px] text-slate-900">
                        {t.name}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Rename ${t.name}`}
                        title="Rename"
                        onClick={() => {
                          setRenamingId(t.id);
                          setRenameValue(t.name);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
                      >
                        <Pencil size={13} strokeWidth={1.5} aria-hidden />
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
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
                      >
                        <Trash2 size={13} strokeWidth={1.5} aria-hidden />
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
            onKeyDown={(e) => {
              // Enter = create. Same gate as the adjacent CREATE button
              // (trimmed, not busy, not a duplicate name).
              if (
                e.key === "Enter" &&
                !busy &&
                trimmedNew &&
                !newDuplicate
              ) {
                e.preventDefault();
                void run(async () => {
                  await createTag({ name: trimmedNew });
                  setNewName("");
                });
              }
            }}
            placeholder="New tag name"
            className="flex-1 rounded-sm border border-slate-200 bg-white px-2 py-1.5 font-mono text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1E3A8A]"
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
            className="inline-flex items-center gap-1.5 rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-white transition-colors duration-150 hover:bg-[#0B3B8C] disabled:opacity-50 disabled:hover:bg-[#1E3A8A]"
            title={newDuplicate ? "Tag already exists" : undefined}
          >
            <Plus size={12} strokeWidth={1.5} aria-hidden />
            Create
          </button>
        </div>
        {newDuplicate && (
          <p className="mt-1 font-mono text-[10.5px] text-slate-500">
            [ INFO ] · tag already exists.
          </p>
        )}
      </div>
    </div>
  );
}
