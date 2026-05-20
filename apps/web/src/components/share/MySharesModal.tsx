// Lists the current user's active shares with per-row Copy / Revoke.
// Read-only otherwise — no rename, no payload preview (defer to v2).

import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  listMyShares,
  revokeShare,
  type MyShareRow,
} from "../../lib/qbank";

interface Props {
  /** Used to build the full URL when copying. Pass the same base the
   * Bundle modal uses; typically window.location.origin. */
  baseUrl: string;
  onClose: () => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function MySharesModal({ baseUrl, onClose }: Props) {
  const [items, setItems] = useState<MyShareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyShares()
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Network error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCopy(row: MyShareRow) {
    const url = `${baseUrl.replace(/\/$/, "")}/s/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedId(row.id);
    setTimeout(
      () => setCopiedId((c) => (c === row.id ? null : c)),
      2000,
    );
  }

  async function onRevoke(row: MyShareRow) {
    if (
      !window.confirm(
        `Revoke this share?\n\n${row.question_count} questions · created ${relativeTime(row.created_at)}\n\nAnyone with the link will get a 410 on import.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      await revokeShare(row.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== row.id));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusyId(null);
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
        <h2 className="text-base font-semibold">My share links</h2>

        <div className="mt-3 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500">
              You haven't created any share links yet.
            </p>
          ) : (
            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {items.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-gray-800">
                      {row.token}
                    </div>
                    <div className="text-xs text-gray-500">
                      {row.question_count} question
                      {row.question_count === 1 ? "" : "s"} ·{" "}
                      {relativeTime(row.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => onCopy(row)}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    {copiedId === row.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => onRevoke(row)}
                    disabled={busyId === row.id}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
