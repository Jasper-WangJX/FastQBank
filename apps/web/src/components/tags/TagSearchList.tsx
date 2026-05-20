// Shared primitive used by TagFilter (in a popover) and TagPicker
// (inline). Owns: the search input + the filtered scrollable list of
// checkbox rows. Stateless w.r.t. selection — the parent owns selectedIds.
//
// Visual: Sapphire Console — sharp 2px corners, hairline slate-200,
// monospace labels, sapphire focus + selected accent.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Tag } from "../../lib/qbank";
import { sortByName } from "./sortByName";

interface Props {
  tags: Tag[];
  selectedIds: string[];
  /** Called with the new full selectedIds set after a toggle. */
  onToggle: (tagId: string) => void;
  /** Optional placeholder for the search input. */
  placeholder?: string;
  /** Optional initial value of the search box (uncontrolled otherwise). */
  initialQuery?: string;
  /** Max list height in px. Default 200. */
  maxListHeight?: number;
  /** When set, called with the typed query so the parent can react. */
  onQueryChange?: (q: string) => void;
}

export default function TagSearchList({
  tags,
  selectedIds,
  onToggle,
  placeholder = "Search tags…",
  initialQuery = "",
  maxListHeight = 200,
  onQueryChange,
}: Props) {
  const [q, setQ] = useState(initialQuery);

  const filtered = useMemo(() => {
    const sorted = sortByName(tags);
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((t) => t.name.toLowerCase().includes(needle));
  }, [tags, q]);

  return (
    <div>
      <div className="group relative flex items-center rounded-sm border border-slate-200 bg-white transition-colors duration-150 focus-within:border-[#1E3A8A]">
        <Search
          size={14}
          strokeWidth={1.5}
          className="ml-2 shrink-0 text-slate-400 group-focus-within:text-[#0B3B8C]"
          aria-hidden
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-[12px] text-slate-900 placeholder:text-slate-400 outline-none"
        />
      </div>

      <div
        className="mt-2 overflow-y-auto rounded-sm border border-slate-200"
        style={{ maxHeight: maxListHeight }}
      >
        {filtered.length === 0 ? (
          <p className="px-2 py-1.5 font-mono text-[11px] text-slate-400">
            No matching tags.
          </p>
        ) : (
          filtered.map((t, i) => {
            const checked = selectedIds.includes(t.id);
            return (
              <label
                key={t.id}
                className={
                  "flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1.5 font-mono text-[12px] transition-colors duration-100 last:border-b-0 hover:bg-[#EFF6FF] " +
                  (checked ? "text-[#1E3A8A]" : "text-slate-700") +
                  // first item should keep the divider feel only between rows
                  (i === 0 ? "" : "")
                }
              >
                {/* A leading mono [✓] / [ ] chip mirrors the IDE vibe of
                 * the Sapphire Console preview while keeping a real
                 * <input type=checkbox> for a11y / keyboard. */}
                <span
                  aria-hidden
                  className={
                    "inline-flex h-[16px] w-[20px] items-center justify-center rounded-sm border font-mono text-[10px] leading-none " +
                    (checked
                      ? "border-[#1E3A8A] bg-[#1E3A8A] text-white"
                      : "border-slate-300 bg-white text-slate-400")
                  }
                >
                  {checked ? "✓" : " "}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(t.id)}
                  className="sr-only"
                />
                <span className="truncate">{t.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
