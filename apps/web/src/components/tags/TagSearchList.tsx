// Shared primitive used by TagFilter (in a popover) and TagPicker
// (inline). Owns: the search input + the filtered scrollable list of
// checkbox rows. Stateless w.r.t. selection — the parent owns selectedIds.

import { useMemo, useState } from "react";
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
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onQueryChange?.(e.target.value);
        }}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-slate-500"
      />
      <div
        className="mt-2 overflow-y-auto rounded-md border border-gray-200"
        style={{ maxHeight: maxListHeight }}
      >
        {filtered.length === 0 ? (
          <p className="px-2 py-1 text-xs text-gray-400">
            No matching tags.
          </p>
        ) : (
          filtered.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(t.id)}
                onChange={() => onToggle(t.id)}
              />
              {t.name}
            </label>
          ))
        )}
      </div>
    </div>
  );
}
