// Lists the current user's active shares with per-row Copy / Revoke.
// Read-only otherwise — no rename, no payload preview (defer to v2).
//
// Visual: Sapphire Console — sharp 2px panel, mono ID + mono date,
// ghost icon-only Copy/Revoke buttons (Link icon + Trash2), inline
// confirm prompt on revoke.

import { useEffect, useState } from "react";
import { Check, Copy, Trash2, X } from "lucide-react";
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
  // Inline two-step revoke prompt — kept local to keep behavior identical
  // (a window.confirm fallback is still used so the public flow is the
  // same: click revoke → confirm → DELETE).
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

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

  async function doRevoke(row: MyShareRow) {
    setBusyId(row.id);
    setError(null);
    try {
      await revokeShare(row.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== row.id));
      setConfirmRevokeId(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-sm border border-slate-200 bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              [ MY SHARES ]
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[#0A2540]">
              My share links
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              {items === null
                ? "loading…"
                : `${items.length} active link${items.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C]"
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="font-mono text-[11px] text-slate-500">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-500">
              You haven't created any share links yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-sm border border-slate-200">
              {items.map((row) => {
                const isConfirming = confirmRevokeId === row.id;
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[#EFF6FF]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12.5px] font-medium text-[#0B3B8C]">
                        {row.token}
                      </div>
                      <div className="font-mono text-[10.5px] text-slate-500">
                        {row.question_count} question
                        {row.question_count === 1 ? "" : "s"} ·{" "}
                        {relativeTime(row.created_at)}
                      </div>
                    </div>

                    {isConfirming ? (
                      <>
                        <span className="font-mono text-[10.5px] uppercase tracking-tight text-[#DC2626]">
                          Revoke?
                        </span>
                        <button
                          type="button"
                          onClick={() => doRevoke(row)}
                          disabled={busyId === row.id}
                          aria-label="Confirm revoke"
                          title="Confirm revoke"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[#DC2626] bg-[#DC2626] text-white transition-colors duration-150 hover:bg-[#B91C1C] disabled:opacity-50"
                        >
                          <Check size={13} strokeWidth={1.5} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(null)}
                          disabled={busyId === row.id}
                          aria-label="Cancel revoke"
                          title="Cancel"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C] disabled:opacity-50"
                        >
                          <X size={13} strokeWidth={1.5} aria-hidden />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onCopy(row)}
                          aria-label="Copy share link"
                          title={copiedId === row.id ? "Copied" : "Copy link"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C]"
                        >
                          {copiedId === row.id ? (
                            <Check
                              size={13}
                              strokeWidth={1.5}
                              className="text-[#0B3B8C]"
                              aria-hidden
                            />
                          ) : (
                            <Copy size={13} strokeWidth={1.5} aria-hidden />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(row.id)}
                          disabled={busyId === row.id}
                          aria-label="Revoke share link"
                          title="Revoke"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 transition-colors duration-150 hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
                        >
                          <Trash2 size={13} strokeWidth={1.5} aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-sm border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#DC2626]">
            [ ERROR ] · {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-[#1E3A8A] bg-[#1E3A8A] px-4 py-1.5 font-mono text-[11px] font-medium uppercase tracking-tight text-white transition-colors duration-150 hover:bg-[#0B3B8C]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
