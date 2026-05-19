// Filter row used by QuestionListPage and ReviewEntryPage. Renders the
// selected-tag chips, an AND/OR toggle, and an always-visible
// TagSearchList below. No popover, no disabled mode — picking a tag
// is itself the way to leave alternate sources (the parent handles the
// transition in onChangeSelected).

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
        "px-2 py-1 text-xs " +
        (match === m
          ? "bg-slate-800 text-white"
          : "text-gray-600 hover:bg-gray-50") +
        (matchInert ? " opacity-50" : "")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-md border border-gray-200 p-2">
      {/* Top row: AND/OR + Manage */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {matchButton("all", "AND")}
          {matchButton("any", "OR")}
        </div>
        <button
          type="button"
          onClick={onOpenManage}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        >
          Manage tags
        </button>
      </div>

      {/* Selected chips */}
      {selectedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="text-gray-500">Selected:</span>
          {selectedTags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700"
            >
              {t.name}
              <button
                type="button"
                aria-label={`Remove ${t.name}`}
                onClick={() => toggle(t.id)}
                className="text-slate-500 hover:text-slate-800"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-gray-300 px-2 py-0.5 hover:bg-gray-50"
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
