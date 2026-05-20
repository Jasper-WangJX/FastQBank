// Filter row used by QuestionListPage and ReviewEntryPage. Renders the
// selected-tag chips, an AND/OR toggle, and an always-visible
// TagSearchList below. No popover, no disabled mode — picking a tag
// is itself the way to leave alternate sources (the parent handles the
// transition in onChangeSelected).
//
// Visual: Sapphire Console — sharp 2px corners, hairline slate-200,
// mono chips, sapphire-active fill on selected segment + chips.

import { Settings, X } from "lucide-react";
import type { Tag } from "../../lib/qbank";
import TagSearchList from "./TagSearchList";

interface Props {
  tags: Tag[];
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  match: "all" | "any";
  onChangeMatch: (m: "all" | "any") => void;
  /** Opens the Manage tags drawer. */
  onOpenManage: () => void;
}

export default function TagFilter({
  tags,
  selectedIds,
  onChangeSelected,
  match,
  onChangeMatch,
  onOpenManage,
}: Props) {
  function toggle(id: string) {
    onChangeSelected(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  function clear() {
    onChangeSelected([]);
  }

  const selectedTags = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => Boolean(t));

  // When no tags are selected, AND/OR has no effect — gray the toggle
  // out so the user isn't tempted to click it.
  const matchInert = selectedIds.length === 0;

  const matchButton = (m: "all" | "any", label: string) => (
    <button
      key={m}
      type="button"
      disabled={matchInert}
      onClick={() => onChangeMatch(m)}
      className={
        "px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-tight transition-colors duration-150 " +
        (match === m
          ? "bg-[#1E3A8A] text-white"
          : "bg-white text-slate-600 hover:bg-[#EFF6FF] hover:text-[#0B3B8C]") +
        (matchInert ? " opacity-50" : "")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-sm border border-slate-200 bg-white p-2">
      {/* Top row: AND/OR + Manage */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-sm border border-slate-200">
          {matchButton("all", "AND")}
          {matchButton("any", "OR")}
        </div>
        <button
          type="button"
          onClick={onOpenManage}
          className="inline-flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-tight text-slate-600 transition-colors duration-150 hover:border-[#2563EB] hover:text-[#0B3B8C]"
        >
          <Settings size={12} strokeWidth={1.5} aria-hidden />
          Manage tags
        </button>
      </div>

      {/* Selected chips */}
      {selectedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Selected:
          </span>
          {selectedTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-sm border border-[#0B3B8C]/15 bg-[#DBEAFE] px-1.5 py-0.5 font-mono text-[11px] text-[#1E3A8A]"
            >
              {t.name}
              <button
                type="button"
                aria-label={`Remove ${t.name}`}
                title={`Remove ${t.name}`}
                onClick={() => toggle(t.id)}
                className="inline-flex h-4 w-4 items-center justify-center text-[#0B3B8C]/70 hover:text-[#1E3A8A]"
              >
                <X size={11} strokeWidth={1.5} aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clear}
            className="ml-1 rounded-sm border border-transparent px-1.5 py-0.5 font-mono text-[11px] text-slate-500 transition-colors duration-150 hover:border-slate-200 hover:bg-slate-50 hover:text-[#0B3B8C]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Always-visible candidate list */}
      <div className="mt-2">
        <TagSearchList
          tags={tags}
          selectedIds={selectedIds}
          onToggle={toggle}
          maxListHeight={240}
        />
      </div>
    </div>
  );
}
