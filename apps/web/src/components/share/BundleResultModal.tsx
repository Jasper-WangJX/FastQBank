// Shown after POST /shares succeeds. Displays the full share URL, a
// [Copy] button, and a short hint about revocability. Closes on
// [Done] or backdrop click. The page's selection is NOT cleared by
// opening or closing this modal — see spec §4.4.
//
// Visual: Sapphire Console — sharp 2px panel, mono eyebrow + sans
// heading, sharp mono read-only URL field with leading link icon and
// trailing copy icon button, sapphire-active primary.

import { useState } from "react";
import { Copy, Link2, X } from "lucide-react";

interface Props {
  url: string;
  questionCount: number;
  onClose: () => void;
}

export default function BundleResultModal({
  url,
  questionCount,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard can fail in non-secure contexts; fall back to select+copy
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-sm border border-slate-200 bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              [ BUNDLE READY ]
            </div>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-[#0A2540]">
              Share link ready
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              anyone with this link can import {questionCount} question
              {questionCount === 1 ? "" : "s"} until you revoke it.
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

        <div className="mt-4 flex items-stretch gap-0 rounded-sm border border-slate-200 focus-within:border-[#1E3A8A]">
          <span className="inline-flex w-9 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-[#0B3B8C]">
            <Link2 size={14} strokeWidth={1.5} aria-hidden />
          </span>
          <input
            readOnly
            value={url}
            className="min-w-0 flex-1 bg-white px-3 py-2 font-mono text-[12px] text-slate-900 outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy share link"
            title="Copy"
            className="inline-flex w-[88px] shrink-0 items-center justify-center gap-1.5 border-l border-slate-200 bg-white font-mono text-[11px] font-medium uppercase tracking-tight text-slate-600 transition-colors duration-150 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]"
          >
            <Copy size={13} strokeWidth={1.5} aria-hidden />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-5 flex justify-end">
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
