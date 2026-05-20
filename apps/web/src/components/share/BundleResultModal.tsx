// Shown after POST /shares succeeds. Displays the full share URL, a
// [Copy] button, and a short hint about revocability. Closes on
// [Close] or backdrop click. The page's selection is NOT cleared by
// opening or closing this modal — see spec §4.4.

import { useState } from "react";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Share link ready</h2>
        <p className="mt-1 text-sm text-gray-600">
          Anyone with this link can import these {questionCount} questions until
          you revoke it.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            onClick={onCopy}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
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
